import { NextResponse } from "next/server";

import { requirePaymentReferenceOwner } from "@/lib/billing/billing-route-authorization";
import { verifyOneTimePayment } from "@/lib/billing/phonepe-status-service";

export async function GET(_: Request, context: { params: Promise<{ merchantTransactionId: string }> }) {
  const { merchantTransactionId } = await context.params;
  const authorization = await requirePaymentReferenceOwner(merchantTransactionId);
  if (!authorization.ok) return authorization.response;

  const result = await verifyOneTimePayment(merchantTransactionId);
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
