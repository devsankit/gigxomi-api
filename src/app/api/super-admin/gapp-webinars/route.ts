import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getGappWebinarAdminView, updateGappWebinar } from "@/lib/gigxomi/gapp-webinar-store";

type WebinarBody = {
  capacity?: unknown;
  countdownEnabled?: unknown;
  currency?: unknown;
  description?: unknown;
  meetingLink?: unknown;
  phonePeEnabled?: unknown;
  priceAmount?: unknown;
  priceMode?: unknown;
  registrationEnabled?: unknown;
  scheduledAt?: unknown;
  title?: unknown;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return undefined;
}

export async function GET() {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) return auth.response;

  const view = await getGappWebinarAdminView();
  return NextResponse.json({ ok: true, ...view });
}

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as WebinarBody | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Webinar payload is required." }, { status: 400 });
  }

  const webinar = await updateGappWebinar({
    capacity: readNumber(body.capacity) ?? null,
    countdownEnabled: readBoolean(body.countdownEnabled),
    currency: readString(body.currency),
    description: readString(body.description),
    meetingLink: readString(body.meetingLink),
    phonePeEnabled: readBoolean(body.phonePeEnabled),
    priceAmount: readNumber(body.priceAmount),
    priceMode: body.priceMode === "FREE" || body.priceMode === "PAID" ? body.priceMode : undefined,
    registrationEnabled: readBoolean(body.registrationEnabled),
    scheduledAt: readString(body.scheduledAt),
    title: readString(body.title),
  });
  const view = await getGappWebinarAdminView();

  return NextResponse.json({ ok: true, webinar, registrations: view.registrations });
}
