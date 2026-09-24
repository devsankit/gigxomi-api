import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { approveManualUpiPayment } from "@/lib/billing/manual-upi-payment-service";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const result = await approveManualUpiPayment({
    transactionId: id,
    reviewedByUserId: auth.session.userId,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
