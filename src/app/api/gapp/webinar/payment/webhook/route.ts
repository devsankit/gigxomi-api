import { NextResponse } from "next/server";

import { assertPhonePeCapabilityEnabled } from "@/lib/billing/phonepe-admin-config-service";
import { readVerifiedPhonePeWebhook } from "@/lib/billing/webhook-verification-service";
import { processGappPaymentWebhook } from "@/lib/gigxomi/gapp-webinar-store";

export async function POST(request: Request) {
  try {
    await assertPhonePeCapabilityEnabled("webhook");
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PhonePe webhook processing is disabled." }, { status: 503 });
  }

  const verified = await readVerifiedPhonePeWebhook(request);
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });
  }

  const result = await processGappPaymentWebhook(verified.payload);
  return NextResponse.json(result);
}
