import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { createTrustDispute } from "@/lib/gigxomi/freelancer-onboarding-service";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const body = await request.json();
  const result = await createTrustDispute(authorization.session.userId, String(body.eventId ?? ""), String(body.reason ?? ""));
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
