import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { getFreelancerOnboardingBackfillReport } from "@/lib/gigxomi/freelancer-onboarding-service";

function hasDeploymentAuthorization(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !supplied) return false;
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

async function authorize(request: Request) {
  if (hasDeploymentAuthorization(request)) return null;
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  return auth.ok ? null : auth.response;
}

export async function GET(request: Request) {
  const denied = await authorize(request); if (denied) return denied;
  return NextResponse.json({ ok: true, report: await getFreelancerOnboardingBackfillReport(false) });
}

export async function POST(request: Request) {
  const denied = await authorize(request); if (denied) return denied;
  return NextResponse.json({ ok: true, report: await getFreelancerOnboardingBackfillReport(true) });
}
