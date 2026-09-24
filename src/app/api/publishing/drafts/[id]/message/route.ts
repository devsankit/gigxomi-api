import { NextResponse } from "next/server";

import { requirePublishingSession } from "@/lib/api/require-publishing-session";
import { buildAssistantTurn, createAssistantMessage, createFreelancerMessage } from "@/lib/publishing/assistant";
import { getPublishingDraftById, updatePublishingDraft } from "@/lib/publishing/store";
import { ALL_PUBLISHING_FIELD_KEYS, type PublishingFieldKey } from "@/lib/publishing/types";
import { listAllServicesFromFile, listConversationsForAudienceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requirePublishingSession(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const existing = await getPublishingDraftById(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Publishing draft not found." }, { status: 404 });
  }

  if (existing.ownerId !== authorization.session.userId && authorization.session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ ok: false, error: "You do not have access to this publishing draft." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { content?: string; fieldKey?: string; lockField?: boolean };
  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json({ ok: false, error: "Reply content is required." }, { status: 400 });
  }
  const fieldKey = ALL_PUBLISHING_FIELD_KEYS.includes(body.fieldKey as PublishingFieldKey)
    ? (body.fieldKey as PublishingFieldKey)
    : undefined;
  const lockField = Boolean(body.lockField && fieldKey);

  try {
    const [services, conversationsPayload] = await Promise.all([
      listAllServicesFromFile(),
      listConversationsForAudienceFromFile("freelancer", {
        freelancerId: authorization.session.userId,
        freelancerNames: [authorization.session.displayName],
      }),
    ]);

    const userMessage = createFreelancerMessage(content, fieldKey ?? existing.currentStep ?? undefined);
    const turn = await buildAssistantTurn({
      record: existing,
      userReply: content,
      fieldKey,
      lockField,
      allServices: services,
      conversations: conversationsPayload.conversations,
    });

    const assistantMessage = createAssistantMessage(turn.payload.assistantMessage, turn.record.currentStep ?? undefined);
    const updated = await updatePublishingDraft(id, {
      status: turn.record.status,
      linkedEntityId: turn.record.linkedEntityId,
      currentStep: turn.record.currentStep,
      missingFields: turn.record.missingFields,
      payload: turn.record.payload,
      rawMessages: [...existing.rawMessages, userMessage, assistantMessage],
      lastSuggestedValues: {
        ...existing.lastSuggestedValues,
        [turn.record.currentStep ?? "completed"]: turn.payload.fieldSuggestions,
      },
    });

    return NextResponse.json({
      ok: true,
      draft: updated,
      suggestion: turn.payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save publishing reply.",
      },
      { status: 500 },
    );
  }
}
