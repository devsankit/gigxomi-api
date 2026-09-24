import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { rejectManualUpiPayment } from "@/lib/billing/manual-upi-payment-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const result = await rejectManualUpiPayment({
    transactionId: id,
    reviewedByUserId: auth.session.userId,
    reason: typeof body?.reason === "string" ? body.reason : undefined,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
