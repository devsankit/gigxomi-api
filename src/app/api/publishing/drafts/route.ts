import { NextResponse } from "next/server";

import { requirePublishingSession } from "@/lib/api/require-publishing-session";
import { upsertPublishingDraftForOwner, listPublishingDrafts } from "@/lib/publishing/store";

export async function GET(request: Request) {
  const authorization = await requirePublishingSession(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");

  if (mode && mode !== "service" && mode !== "portfolio") {
    return NextResponse.json({ ok: false, error: "Unsupported publishing mode." }, { status: 400 });
  }

  const drafts = await listPublishingDrafts(authorization.session.userId, (mode as "service" | "portfolio" | null) ?? undefined);
  return NextResponse.json({
    ok: true,
    drafts,
  });
}

export async function POST(request: Request) {
  const authorization = await requirePublishingSession(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  if (body.mode !== "service" && body.mode !== "portfolio") {
    return NextResponse.json({ ok: false, error: "mode must be service or portfolio." }, { status: 400 });
  }

  try {
    const draft = await upsertPublishingDraftForOwner({
      ownerId: authorization.session.userId,
      ownerDisplayName: authorization.session.displayName,
      mode: body.mode,
    });

    return NextResponse.json({
      ok: true,
      draft,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to create publishing draft.",
      },
      { status: 500 },
    );
  }
}
