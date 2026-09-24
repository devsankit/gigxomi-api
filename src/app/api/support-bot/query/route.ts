import { NextResponse } from "next/server";

import { querySupportBot, type KnowledgeBaseRole } from "@/lib/gigxomi/knowledge-base-store";

function normalizeRole(value: unknown): KnowledgeBaseRole | null {
  const role = String(value ?? "").trim().toUpperCase();
  return role === "FREELANCER" || role === "AGENCY" || role === "PLATFORM" ? role : null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    role?: unknown;
    sessionId?: unknown;
  } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!message) {
    return NextResponse.json({ ok: false, error: "Message is required." }, { status: 400 });
  }

  const result = await querySupportBot({
    message,
    role: normalizeRole(body?.role),
    sessionId: typeof body?.sessionId === "string" ? body.sessionId : null,
  });

  return NextResponse.json(result);
}
