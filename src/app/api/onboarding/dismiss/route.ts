import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { onboardingChecklistByRole } from "@/lib/gigxomi/onboarding-config";
import { upsertOnboardingProgress } from "@/lib/gigxomi/onboarding-progress-store";

export async function POST() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const checklist = onboardingChecklistByRole[authorization.session.role];
  const progress = await upsertOnboardingProgress(authorization.session.userId, authorization.session.role, checklist.key, {
    dismissed: true,
  });

  return NextResponse.json({ ok: true, checklist, progress });
}
