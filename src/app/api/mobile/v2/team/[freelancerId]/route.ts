import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { calculateFreelancerTrustScore } from "@/lib/gigxomi/freelancer-onboarding-service";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ freelancerId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await requireSessionRole(["ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const { freelancerId } = await context.params;
  const tenantId = authorization.session.tenantId || "";
  const membership = await prisma.appTeamMembership.findUnique({ where: { tenantId_freelancerId: { tenantId, freelancerId } } });
  if (!membership || membership.status !== "ACTIVE") return NextResponse.json({ ok: false, error: "Freelancer is not an active member of this agency." }, { status: 404 });
  const [freelancer, assignments, payments, ratings] = await Promise.all([
    prisma.appAuthUser.findUnique({ where: { id: freelancerId }, select: { id: true, displayName: true, email: true, freelancerTrustSnapshot: true } }),
    prisma.appAssignmentRecord.findMany({ where: { tenantId, freelancerId }, orderBy: { createdAt: "desc" } }),
    prisma.appPaymentRequest.findMany({ where: { tenantId, freelancerId }, orderBy: { createdAt: "desc" } }),
    prisma.appFreelancerRating.findMany({ where: { freelancerId, agencyUserId: authorization.session.userId }, orderBy: { createdAt: "desc" } }),
  ]);
  const paidStatuses = new Set(["PAID", "WALLET_CREDITED", "EDITOR_PAYOUT_PAID"]);
  const ignoredStatuses = new Set(["REJECTED", "CANCELLED"]);
  const paid = payments.filter((item) => paidStatuses.has(item.status)).reduce((sum, item) => sum + (item.approvedAmount ?? item.requestedAmount), 0);
  const unpaid = payments.filter((item) => !paidStatuses.has(item.status) && !ignoredStatuses.has(item.status)).reduce((sum, item) => sum + (item.approvedAmount ?? item.requestedAmount), 0);
  return NextResponse.json({
    ok: true,
    member: { ...membership, freelancer },
    projects: assignments,
    ratings,
    accounting: { paid, unpaid, total: paid + unpaid, currency: "INR" },
    projectSummary: {
      completed: assignments.filter((item) => item.status === "COMPLETED").length,
      active: assignments.filter((item) => ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "REVISION_REQUESTED", "SUBMITTED"].includes(item.status)).length,
    },
  });
}
export async function POST(request: Request, context: RouteContext) {
  const authorization = await requireSessionRole(["ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const { freelancerId } = await context.params;
  const tenantId = authorization.session.tenantId || "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const assignmentId = typeof body?.assignmentId === "string" ? body.assignmentId : "";
  const score = Math.round(Number(body?.score ?? 0));
  if (score < 1 || score > 5) return NextResponse.json({ ok: false, error: "Rating must be between 1 and 5." }, { status: 400 });
  const assignment = await prisma.appAssignmentRecord.findFirst({ where: { id: assignmentId, tenantId, freelancerId, status: "COMPLETED" } });
  if (!assignment) return NextResponse.json({ ok: false, error: "Only a completed agency assignment can be rated." }, { status: 400 });
  const rating = await prisma.appFreelancerRating.upsert({
    where: { assignmentId_agencyUserId: { assignmentId, agencyUserId: authorization.session.userId } },
    create: { freelancerId, agencyUserId: authorization.session.userId, assignmentId, score, comment: typeof body?.comment === "string" ? body.comment.trim() || null : null },
    update: { score, comment: typeof body?.comment === "string" ? body.comment.trim() || null : null },
  });
  const trust = await calculateFreelancerTrustScore(freelancerId);
  return NextResponse.json({ ok: true, rating, trust });
}
