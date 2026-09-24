import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getFreelancerReferralDashboard, trackReferralClick } from "@/lib/referrals/freelancer-referral-service";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const session = authorization.session;
  const dashboard = await getFreelancerReferralDashboard(session.userId, {
    phone: session.phone,
    displayName: session.displayName,
  });

  return NextResponse.json(dashboard);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!code) {
    return NextResponse.json({ ok: false, error: "Referral code is required." }, { status: 400 });
  }

  const tracked = await trackReferralClick(code);
  return NextResponse.json({ ok: tracked });
}
