import { NextResponse } from "next/server";

import { requireSubscriptionReferenceOwner } from "@/lib/billing/billing-route-authorization";
import { updateSubscriptionStatusFromProvider } from "@/lib/billing/phonepe-status-service";

export async function GET(_: Request, context: { params: Promise<{ merchantSubscriptionId: string }> }) {
  const { merchantSubscriptionId } = await context.params;
  const authorization = await requireSubscriptionReferenceOwner(merchantSubscriptionId);
  if (!authorization.ok) return authorization.response;

  const subscription = await updateSubscriptionStatusFromProvider(merchantSubscriptionId);
  return NextResponse.json({
    ok: true,
    subscription: {
      id: subscription.id,
      packageId: subscription.packageId,
      status: subscription.status,
      expiresAt: subscription.expiresAt,
      nextRenewalAt: subscription.renewsAt ?? subscription.nextBillingDate,
    },
  });
}
