import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { assignFreelancerAssessment, submitFreelancerAssessment } from "@/lib/gigxomi/freelancer-onboarding-service";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const result = await assignFreelancerAssessment(authorization.session.userId, null);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const body = await request.json();
  const result = await submitFreelancerAssessment(authorization.session.userId, body.answers);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
