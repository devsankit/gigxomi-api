import { NextResponse } from "next/server";

import { processDueRenewals } from "@/lib/billing/recurring-billing-service";
import { processSubscriptionExpiryReminders } from "@/lib/billing/subscription-reminder-service";

export async function POST(request: Request) {
  const configuredSecret = process.env.BILLING_JOB_SECRET?.trim();
  const providedSecret = request.headers.get("x-billing-job-secret")?.trim() || new URL(request.url).searchParams.get("secret")?.trim();
  if (!configuredSecret || providedSecret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Invalid billing job secret." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { limit?: number } | null;
  const limit = body?.limit ?? 25;
  const renewalResult = await processDueRenewals(limit);
  const reminderResult = await processSubscriptionExpiryReminders(limit);
  return NextResponse.json({
    ok: true,
    renewals: renewalResult,
    reminders: reminderResult,
  });
}
