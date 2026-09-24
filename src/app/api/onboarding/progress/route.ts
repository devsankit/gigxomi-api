import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { onboardingChecklistByRole } from "@/lib/gigxomi/onboarding-config";
import { getOnboardingProgress, upsertOnboardingProgress } from "@/lib/gigxomi/onboarding-progress-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const checklist = onboardingChecklistByRole[authorization.session.role];
  const progress = await getOnboardingProgress(authorization.session.userId, authorization.session.role, checklist.key);

  return NextResponse.json({ ok: true, checklist, progress });
}

export async function PATCH(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const checklist = onboardingChecklistByRole[authorization.session.role];
  const body = (await request.json().catch(() => ({}))) as {
    completedSteps?: string[];
    skippedSteps?: string[];
    dismissed?: boolean;
    completedAt?: string | null;
    lastSeenStep?: string | null;
  };

  const progress = await upsertOnboardingProgress(authorization.session.userId, authorization.session.role, checklist.key, {
    completedSteps: Array.isArray(body.completedSteps) ? body.completedSteps.map(String) : undefined,
    skippedSteps: Array.isArray(body.skippedSteps) ? body.skippedSteps.map(String) : undefined,
    dismissed: typeof body.dismissed === "boolean" ? body.dismissed : undefined,
    completedAt: typeof body.completedAt === "string" || body.completedAt === null ? body.completedAt : undefined,
    lastSeenStep: typeof body.lastSeenStep === "string" || body.lastSeenStep === null ? body.lastSeenStep : undefined,
  });

  return NextResponse.json({ ok: true, checklist, progress });
}
