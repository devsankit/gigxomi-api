import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { listAllServicesFromFile, reviewFreelancerServiceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { calculateFreelancerTrustScore } from "@/lib/gigxomi/freelancer-onboarding-service";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireSessionRole(["SUPER_ADMIN"]); if (!auth.ok) return auth.response;
  const [reviews, services, disputes] = await Promise.all([
    prisma.appFreelancerPortfolioReview.findMany({ orderBy: { submittedAt: "desc" }, take: 100, include: { freelancer: { select: { displayName: true, email: true, phone: true } } } }),
    listAllServicesFromFile(),
    prisma.appFreelancerTrustDispute.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, include: { event: true, user: { select: { displayName: true } } } }),
  ]);
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const ids = Array.from(new Set(reviews.map((item) => item.freelancerId)));
  const [assessments, scores] = await Promise.all([
    prisma.appFreelancerAssessment.findMany({ where: { userId: { in: ids } }, select: { userId: true, score: true } }),
    prisma.appFreelancerTrustSnapshot.findMany({ where: { userId: { in: ids } }, select: { userId: true, score: true, provisional: true } }),
  ]);
  const assessmentMap = new Map(assessments.map((item) => [item.userId, item.score])); const scoreMap = new Map(scores.map((item) => [item.userId, item]));
  return NextResponse.json({ ok: true, reviews: reviews.map((review) => ({ ...review, service: serviceMap.get(review.serviceId) ?? null, assessmentScore: assessmentMap.get(review.freelancerId) ?? null, trust: scoreMap.get(review.freelancerId) ?? null })), disputes });
}

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]); if (!auth.ok) return auth.response;
  const body = await request.json(); const reviewId = String(body.reviewId ?? "").trim(); const action = String(body.action ?? "").trim().toUpperCase(); const note = String(body.note ?? "").trim();
  if (!reviewId || !["APPROVE", "REQUEST_CHANGES", "REJECT"].includes(action)) return NextResponse.json({ ok: false, error: "Choose a valid portfolio review action." }, { status: 400 });
  if (action !== "APPROVE" && !note) return NextResponse.json({ ok: false, error: "Add clear reviewer feedback." }, { status: 400 });
  const review = await prisma.appFreelancerPortfolioReview.findUnique({ where: { id: reviewId } }); if (!review) return NextResponse.json({ ok: false, error: "Portfolio review was not found." }, { status: 404 });
  const service = await reviewFreelancerServiceFromFile(review.serviceId, action === "APPROVE" ? "approve" : "reject", note);
  const status = action === "APPROVE" ? "APPROVED" : action === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "REJECTED";
  const updated = await prisma.appFreelancerPortfolioReview.update({ where: { id: review.id }, data: { status, note: note || "Portfolio approved for Gigxomi discovery.", reviewedByUserId: auth.session.userId, reviewedAt: new Date() } });
  await calculateFreelancerTrustScore(review.freelancerId);
  await createAppNotification({ userId: review.freelancerId, type: "portfolio_review", title: action === "APPROVE" ? "Portfolio approved" : action === "REQUEST_CHANGES" ? "Portfolio changes requested" : "Portfolio not approved", message: action === "APPROVE" ? "Your service is now eligible for agency discovery and your Trust Score has been updated." : note, entityType: "service", entityId: review.serviceId });
  return NextResponse.json({ ok: true, review: updated, service });
}
