import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listPaymentRequestsForActor } from "@/lib/gigxomi/app-payment-request-service";

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const audience = new URL(request.url).searchParams.get("audience");
  const result = await listPaymentRequestsForActor(authorization.session, audience);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    paymentRequests: result.requests,
  });
}
