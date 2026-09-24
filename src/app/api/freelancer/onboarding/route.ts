import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getFreelancerOnboardingState, isFreelancerOnboardingEnabled } from "@/lib/gigxomi/freelancer-onboarding-service";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  if (!isFreelancerOnboardingEnabled()) return NextResponse.json({ ok: true, onboarding: { completed: true, currentStep: 3, status: "DISABLED" } });
  try {
    return NextResponse.json({ ok: true, onboarding: await getFreelancerOnboardingState(authorization.session) });
  } catch (error) {
    console.error("[freelancer/onboarding] Error getting state:", error);
    return NextResponse.json({
      ok: true,
      onboarding: {
        completed: true,
        currentStep: 3,
        status: "COMPLETED",
        profile: { completed: true },
      },
    });
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const body = await request.json();
  const { prisma } = await import("@/lib/prisma");

  if (body.action === "skip" || body.stage === "skip") {
    await prisma.appFreelancerOnboarding.upsert({
      where: { userId: authorization.session.userId },
      create: {
        userId: authorization.session.userId,
        status: "SKIPPED",
        completedAt: new Date(),
      },
      update: {
        status: "SKIPPED",
        completedAt: new Date(),
      },
    });
    const response = NextResponse.json({ ok: true, completed: true, skipped: true });
    response.cookies.set("gx_freelancer_skipped", "1", {
      path: "/",
      sameSite: "lax",
      maxAge: 86400 * 365,
    });
    return response;
  }

  if (body.stage === "service" || body.stage === "profile") {
    const draft = typeof body.draft === "object" && body.draft && !Array.isArray(body.draft) ? body.draft : {};
    if (JSON.stringify(draft).length > 50_000) return NextResponse.json({ ok: false, error: "Onboarding draft is too large." }, { status: 413 });
    const data = body.stage === "service" ? { serviceDraft: draft } : { profileDraft: draft };
    await prisma.appFreelancerOnboarding.upsert({ where: { userId: authorization.session.userId }, create: { userId: authorization.session.userId, ...data }, update: data });
    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
  }
  if (body.stage === "assessment") {
    const assessment = await prisma.appFreelancerAssessment.findUnique({ where: { userId: authorization.session.userId } });
    if (!assessment || assessment.submittedAt) return NextResponse.json({ ok: false, error: "Assessment is not available for autosave." }, { status: 409 });
    const input = typeof body.draft === "object" && body.draft && !Array.isArray(body.draft) ? body.draft as Record<string, unknown> : {};
    const answers = Object.fromEntries(assessment.questionIds.flatMap((questionId) => typeof input[questionId] === "string" && ["a", "b", "c"].includes(input[questionId]) ? [[questionId, input[questionId]]] : []));
    await prisma.appFreelancerAssessment.update({ where: { userId: authorization.session.userId }, data: { answers } });
    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
  }
  const onboarding = await prisma.appFreelancerOnboarding.upsert({ where: { userId: authorization.session.userId }, create: { userId: authorization.session.userId, campaignOptOut: Boolean(body.campaignOptOut) }, update: { campaignOptOut: Boolean(body.campaignOptOut) } });
  return NextResponse.json({ ok: true, campaignOptOut: onboarding.campaignOptOut });
}

export async function POST(request: Request) {
  return PATCH(request);
}
