import { NextResponse } from "next/server";

import { handoffSupportBot } from "@/lib/gigxomi/knowledge-base-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    phone?: unknown;
    question?: unknown;
    sessionId?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const question = typeof body?.question === "string" ? body.question.trim() : "";

  if (!name || !phone || !question) {
    return NextResponse.json({ ok: false, error: "Name, WhatsApp number, and question are required." }, { status: 400 });
  }

  const result = await handoffSupportBot({
    name,
    phone,
    question,
    sessionId: typeof body?.sessionId === "string" ? body.sessionId : null,
  });

  return NextResponse.json(result);
}
