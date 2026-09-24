import { NextResponse } from "next/server";

import { assertPhonePeCapabilityEnabled } from "@/lib/billing/phonepe-admin-config-service";
import { processPhonePeSubscriptionWebhook } from "@/lib/billing/phonepe-status-service";
import { readVerifiedPhonePeWebhook } from "@/lib/billing/webhook-verification-service";

export async function POST(request: Request) {
  try {
    await assertPhonePeCapabilityEnabled("webhook");
  } catch {
    return NextResponse.json({ ok: false, code: "PHONEPE_WEBHOOK_UNAVAILABLE", error: "PhonePe webhook processing is unavailable. Retry delivery." }, { status: 503 });
  }

  try {
  const verified = await readVerifiedPhonePeWebhook(request);
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });
  }

    return NextResponse.json(await processPhonePeSubscriptionWebhook(verified.payload));
  } catch {
    return NextResponse.json({ ok: false, code: "PAYMENT_CONFIRMATION_PENDING", error: "Please retry webhook delivery." }, { status: 503 });
  }
}
