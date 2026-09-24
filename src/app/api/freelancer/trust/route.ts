import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { listFreelancerTrustHistory } from "@/lib/gigxomi/freelancer-onboarding-service";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  return NextResponse.json({ ok: true, ...(await listFreelancerTrustHistory(authorization.session.userId)) });
}
