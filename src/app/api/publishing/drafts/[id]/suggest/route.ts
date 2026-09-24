import { NextResponse } from "next/server";

import { requirePublishingSession } from "@/lib/api/require-publishing-session";
import { buildAssistantTurn, createAssistantMessage } from "@/lib/publishing/assistant";
import { getPublishingDraftById, updatePublishingDraft } from "@/lib/publishing/store";
import { listAllServicesFromFile, listConversationsForAudienceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
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

  try {
    const [services, conversationsPayload] = await Promise.all([
      listAllServicesFromFile(),
      listConversationsForAudienceFromFile("freelancer", {
        freelancerId: authorization.session.userId,
        freelancerNames: [authorization.session.displayName],
      }),
    ]);

    const turn = await buildAssistantTurn({
      record: existing,
      allServices: services,
      conversations: conversationsPayload.conversations,
    });

    const assistantMessage = createAssistantMessage(turn.payload.assistantMessage, turn.record.currentStep ?? undefined);
    const shouldAppendAssistant = !existing.rawMessages.length || existing.rawMessages.at(-1)?.content !== assistantMessage.content;

    const updated = await updatePublishingDraft(id, {
      status: turn.record.status,
      linkedEntityId: turn.record.linkedEntityId,
      currentStep: turn.record.currentStep,
      missingFields: turn.record.missingFields,
      payload: turn.record.payload,
      rawMessages: shouldAppendAssistant ? [...existing.rawMessages, assistantMessage] : existing.rawMessages,
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
        error: error instanceof Error ? error.message : "Unable to build publishing suggestions.",
      },
      { status: 500 },
    );
  }
}
