import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getCouponQuote } from "@/lib/connected-platform/coupons";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const quote = await getCouponQuote({
      code: typeof body?.code === "string" ? body.code : "",
      packageId: typeof body?.packageId === "string" ? body.packageId : "",
      userId: authorization.session.userId,
    });
    return NextResponse.json({ ok: true, coupon: quote });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Coupon is not valid." }, { status: 400 });
  }
}
