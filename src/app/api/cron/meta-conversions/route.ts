import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { captureWhatsAppAdLeads } from "@/lib/meta/whatsapp-ad-attribution";
import { deliverMetaConversions } from "@/lib/meta/conversions-api";
let running = false;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ ok: false }, { status: 401 });
  if (running) return NextResponse.json({ ok: true, busy: true });
  running = true;
  try {
    const attribution = await captureWhatsAppAdLeads().catch(() => ({ configured: false, error: "attribution_unavailable" }));
    const delivery = await deliverMetaConversions();
    return NextResponse.json({ ok: true, attribution, delivery });
  } finally { running = false; }
}
