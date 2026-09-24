import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";
import { PhonePeMandateAutopayProvider } from "@/lib/billing/phonepe-providers";

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { subscriptionId?: string; pauseStartDate?: string; pauseEndDate?: string } | null;
  const subscriptionId = body?.subscriptionId?.trim();
  if (!subscriptionId) return NextResponse.json({ ok: false, error: "Subscription id is required." }, { status: 400 });

  const subscription = await prisma.userSubscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription?.merchantSubscriptionId) return NextResponse.json({ ok: false, error: "Subscription mandate is not ready." }, { status: 400 });

  const pauseStartDate = body?.pauseStartDate ? new Date(body.pauseStartDate) : new Date();
  const pauseEndDate = body?.pauseEndDate ? new Date(body.pauseEndDate) : null;
  const provider = new PhonePeMandateAutopayProvider();
  const result = await provider.pause({ merchantSubscriptionId: subscription.merchantSubscriptionId, pauseStartDate, pauseEndDate });
  await prisma.userSubscription.update({
    where: { id: subscription.id },
    data: { status: "PAUSED", pauseStartDate, pauseEndDate, subscriptionState: result.state },
  });
  await prisma.recurringBillingEvent.create({
    data: { subscriptionId: subscription.id, eventType: "PAUSE", providerReference: subscription.merchantSubscriptionId, payload: result.raw as object, state: result.state, occurredAt: new Date() },
  });
  return NextResponse.json({ ok: true, result });
}
