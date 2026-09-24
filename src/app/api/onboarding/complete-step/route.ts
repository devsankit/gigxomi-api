import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { onboardingChecklistByRole } from "@/lib/gigxomi/onboarding-config";
import { getOnboardingProgress, upsertOnboardingProgress } from "@/lib/gigxomi/onboarding-progress-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const checklist = onboardingChecklistByRole[authorization.session.role];
  const body = (await request.json().catch(() => ({}))) as { stepId?: string };
  const stepId = String(body.stepId ?? "").trim();

  if (!stepId) {
    return NextResponse.json({ ok: false, error: "stepId is required" }, { status: 400 });
  }

  const current = await getOnboardingProgress(authorization.session.userId, authorization.session.role, checklist.key);
  const completedSteps = Array.from(new Set([...(current?.completedSteps ?? []), stepId]));
  const total = checklist.steps.length;
  const completedAt = completedSteps.length >= total ? new Date().toISOString() : current?.completedAt ?? null;

  const progress = await upsertOnboardingProgress(authorization.session.userId, authorization.session.role, checklist.key, {
    completedSteps,
    completedAt,
    lastSeenStep: stepId,
  });

  return NextResponse.json({ ok: true, checklist, progress });
}
