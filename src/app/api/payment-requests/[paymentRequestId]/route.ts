import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { updateAssignmentPaymentRequest } from "@/lib/gigxomi/app-payment-request-service";

export async function PATCH(request: Request, context: { params: Promise<{ paymentRequestId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { paymentRequestId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await updateAssignmentPaymentRequest(authorization.session, paymentRequestId, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    assignment: result.assignment,
    paymentRequest: result.request,
    walletEntry: "walletEntry" in result ? result.walletEntry : null,
  });
}
