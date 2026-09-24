import { NextResponse } from "next/server";

import { requirePaymentReferenceOwner } from "@/lib/billing/billing-route-authorization";
import { verifyAutopaySetup } from "@/lib/billing/phonepe-status-service";

export async function GET(_: Request, context: { params: Promise<{ merchantOrderId: string }> }) {
  const { merchantOrderId } = await context.params;
  const authorization = await requirePaymentReferenceOwner(merchantOrderId);
  if (!authorization.ok) return authorization.response;

  const result = await verifyAutopaySetup(merchantOrderId);
  const paymentStatus = "transaction" in result && result.transaction
    ? result.transaction.status
    : result.subscription?.paymentStatus ?? authorization.transaction.status;
  return NextResponse.json({
    ok: true,
    result: {
      packageId: result.pkg?.id ?? authorization.transaction.packageId,
      paymentStatus,
      subscriptionStatus: result.subscription?.status ?? null,
    },
  });
}
