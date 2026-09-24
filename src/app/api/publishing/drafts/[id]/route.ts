import { NextResponse } from "next/server";

import { requirePublishingSession } from "@/lib/api/require-publishing-session";
import { getPublishingDraftById, updatePublishingDraft } from "@/lib/publishing/store";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
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

  return NextResponse.json({
    ok: true,
    draft: existing,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
    const body = (await request.json().catch(() => ({}))) as Partial<typeof existing>;
    const updated = await updatePublishingDraft(id, {
      status: body.status,
      linkedEntityId: typeof body.linkedEntityId === "undefined" ? undefined : body.linkedEntityId,
      currentStep: typeof body.currentStep === "undefined" ? undefined : body.currentStep,
      missingFields: body.missingFields,
      payload: body.payload,
      rawMessages: body.rawMessages,
      lastSuggestedValues: body.lastSuggestedValues,
    });

    return NextResponse.json({
      ok: true,
      draft: updated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to update publishing draft.",
      },
      { status: 500 },
    );
  }
}
