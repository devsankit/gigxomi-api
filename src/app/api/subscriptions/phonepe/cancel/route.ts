import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";
import { PhonePeMandateAutopayProvider } from "@/lib/billing/phonepe-providers";

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "FREELANCER"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { subscriptionId?: string; reason?: string } | null;
  const subscriptionId = body?.subscriptionId?.trim();
  if (!subscriptionId) return NextResponse.json({ ok: false, error: "Subscription id is required." }, { status: 400 });

  const subscription = await prisma.userSubscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription?.merchantSubscriptionId) return NextResponse.json({ ok: false, error: "Subscription mandate is not ready." }, { status: 400 });
  if (auth.session.role !== "SUPER_ADMIN" && subscription.userId !== auth.session.userId) {
    return NextResponse.json({ ok: false, error: "You do not have access to this subscription." }, { status: 403 });
  }

  const provider = new PhonePeMandateAutopayProvider();
  const result = await provider.cancel(subscription.merchantSubscriptionId);
  await prisma.userSubscription.update({
    where: { id: subscription.id },
    data: {
      status: "CANCELLED",
      autoRenew: false,
      expiresAt: subscription.expiresAt ?? subscription.renewsAt ?? subscription.nextBillingDate,
      cancelledAt: new Date(),
      cancellationReason: body?.reason?.trim() || "user_requested",
      subscriptionState: result.state,
    },
  });
  await prisma.recurringBillingEvent.create({
    data: { subscriptionId: subscription.id, eventType: "CANCEL", providerReference: subscription.merchantSubscriptionId, payload: result.raw as object, state: result.state, occurredAt: new Date() },
  });
  return NextResponse.json({ ok: true, result });
}
