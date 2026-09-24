import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { calculateFreelancerTrustScore } from "@/lib/gigxomi/freelancer-onboarding-service";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]); if (!auth.ok) return auth.response;
  const body = await request.json(); const userId = String(body.userId ?? "").trim();
  if (!userId) return NextResponse.json({ ok: false, error: "Freelancer is required." }, { status: 400 });
  const assessment = await prisma.appFreelancerAssessment.findUnique({ where: { userId } });
  if (!assessment) return NextResponse.json({ ok: false, error: "Assessment was not found." }, { status: 404 });
  await prisma.appFreelancerAssessment.update({
    where: { userId },
    data: {
      answers: {},
      score: null,
      submittedAt: null,
      resetAt: new Date(),
      resetByUserId: auth.session.userId,
    },
  });
  await prisma.appFreelancerOnboarding.updateMany({ where: { userId }, data: { status: "IN_PROGRESS", currentStep: 2, completedAt: null } });
  await calculateFreelancerTrustScore(userId);
  return NextResponse.json({ ok: true });
}
