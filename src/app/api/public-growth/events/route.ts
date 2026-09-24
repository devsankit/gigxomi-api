import { NextResponse } from "next/server";

import { appendMarketingDebugEvent } from "@/lib/gigxomi/public-growth-store";

type IncomingGrowthEvent = {
  event?: unknown;
  path?: unknown;
  url?: unknown;
  referrer?: unknown;
  payload?: unknown;
};

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readPayload(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as IncomingGrowthEvent | null;
  const event = readTrimmedString(body?.event);

  if (!event) {
    return NextResponse.json({ ok: false, error: "Marketing event name is required." }, { status: 400 });
  }

  await appendMarketingDebugEvent({
    event,
    path: readTrimmedString(body?.path) || null,
    url: readTrimmedString(body?.url) || null,
    referrer: readTrimmedString(body?.referrer) || null,
    userAgent: request.headers.get("user-agent"),
    payload: readPayload(body?.payload),
  });

  return NextResponse.json({ ok: true });
}
