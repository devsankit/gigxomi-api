import { NextResponse } from "next/server";
import type { TeamMembershipStatus } from "@prisma/client";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listFreelancerServicesFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { listMarketingDebugEvents } from "@/lib/gigxomi/public-growth-store";
import { prisma } from "@/lib/prisma";
import { calculateFreelancerTrustScore } from "@/lib/gigxomi/freelancer-onboarding-service";

type FreelancerDashboardPayload = {
  ok: boolean;
  trust: { score: number; band: string; provisional: boolean; nextAction: string };
  stats: {
    activeAssignments?: number;
    pendingPaymentRequests?: number;
    applicationsAccepted?: number;
    applicationsRejected?: number;
    applicationsShortlisted?: number;
    applicationsSubmitted?: number;
    applicationSelectionRate?: number;
    averageApplyResponseHours?: number;
    projectsDone: number;
    revisionRequests?: number;
    walletAvailable?: number;
    workingWithAgencies: number;
    serviceViews: number;
  };
};

const COMPLETED_MEMBERSHIP_STATUSES = new Set<TeamMembershipStatus>(["ACTIVE"]);

function readServiceId(payload: Record<string, unknown>) {
  const value = payload.serviceId;
  return typeof value === "string" ? value.trim() : "";
}

function diffHours(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 36e5));
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const session = authorization.session;
  const identityFilters = [session.phone ? { phone: session.phone } : null, session.email ? { email: session.email } : null].filter(Boolean) as Array<{
    phone?: string;
    email?: string;
  }>;

  const legacyUserPromise = prisma.editorProfile.findFirst({ where: { userId: session.userId } }).then((ep) => (ep ? { editorProfile: ep } : null)).catch(() => null);

  const [legacyUser, services, recentEvents, appAssignments, appMembershipCount, pendingPaymentRequestCount, walletAvailableAggregate, revisionRequestCount, appApplications] = await Promise.all([
    legacyUserPromise,
    listFreelancerServicesFromFile(session.userId),
    listMarketingDebugEvents(300),
    prisma.appAssignmentRecord.findMany({ where: { freelancerId: session.userId }, select: { status: true } }),
    prisma.appTeamMembership.count({ where: { freelancerId: session.userId, status: "ACTIVE" } }),
    prisma.appPaymentRequest.count({ where: { freelancerId: session.userId, status: { in: ["PAYMENT_PENDING", "PAYMENT_FAILED"] } } }),
    prisma.appFreelancerWalletEntry.aggregate({ where: { freelancerId: session.userId, status: "AVAILABLE" }, _sum: { netAmount: true } }),
    prisma.appRevisionRequest.count({ where: { freelancerId: session.userId, status: "REQUESTED" } }),
    prisma.appTaskApplication.findMany({ where: { freelancerId: session.userId }, select: { taskId: true, status: true, createdAt: true } }),
  ]);
  const walletAvailable = walletAvailableAggregate._sum.netAmount ?? 0;
  const trustSnapshot = await calculateFreelancerTrustScore(session.userId);
  const trust = {
    score: trustSnapshot.score,
    band: trustSnapshot.score >= 80 ? "EXCELLENT" : trustSnapshot.score >= 60 ? "GOOD" : trustSnapshot.score >= 40 ? "BUILDING" : "NEW",
    provisional: trustSnapshot.provisional,
    nextAction: trustSnapshot.nextAction || "Complete more work and learning to strengthen your score.",
  };
  const applicationTaskIds = Array.from(new Set(appApplications.map((application) => application.taskId)));
  const applicationTasks = applicationTaskIds.length
    ? await prisma.appMarketplaceTask.findMany({ where: { id: { in: applicationTaskIds } }, select: { id: true, createdAt: true } })
    : [];
  const applicationTaskMap = new Map(applicationTasks.map((task) => [task.id, task]));
  const acceptedApplications = appApplications.filter((application) => application.status === "ACCEPTED").length;
  const shortlistedApplications = appApplications.filter((application) => application.status === "SHORTLISTED").length;
  const rejectedApplications = appApplications.filter((application) => application.status === "REJECTED").length;
  const applyResponseHours = appApplications
    .map((application) => {
      const task = applicationTaskMap.get(application.taskId);
      return task ? diffHours(task.createdAt, application.createdAt) : null;
    })
    .filter((value): value is number => value !== null);
  const averageApplyResponseHours = applyResponseHours.length
    ? Math.round(applyResponseHours.reduce((total, item) => total + item, 0) / applyResponseHours.length)
    : 0;
  const applicationSelectionRate = appApplications.length ? Math.round((acceptedApplications / appApplications.length) * 100) : 0;
  const applicationStats = {
    applicationsAccepted: acceptedApplications,
    applicationsRejected: rejectedApplications,
    applicationsShortlisted: shortlistedApplications,
    applicationsSubmitted: appApplications.length,
    applicationSelectionRate,
    averageApplyResponseHours,
  };
  const serviceIds = new Set(services.map((service) => service.id));
  const serviceViews = recentEvents.filter((event) => event.event === "gigxomi_service_viewed").filter((event) => {
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? (event.payload as Record<string, unknown>) : {};
    const serviceId = readServiceId(payload);
    return serviceId && serviceIds.has(serviceId);
  }).length;

  if (!legacyUser?.editorProfile) {
    const payload: FreelancerDashboardPayload = {
      ok: true,
      trust,
      stats: {
        activeAssignments: appAssignments.filter((item) => !["COMPLETED", "PAYMENT_APPROVED", "PAID", "CANCELLED", "DISPUTED"].includes(item.status)).length,
        ...applicationStats,
        pendingPaymentRequests: pendingPaymentRequestCount,
        projectsDone: appAssignments.filter((item) => ["COMPLETED", "PAYMENT_APPROVED", "PAID"].includes(item.status)).length,
        revisionRequests: revisionRequestCount,
        walletAvailable,
        workingWithAgencies: appMembershipCount,
        serviceViews,
      },
    };

    return NextResponse.json(payload);
  }

  const editorProfileId = legacyUser.editorProfile.id;

  const [completedProjects, memberships] = await Promise.all([
    prisma.assignment.count({
      where: {
        editorProfileId,
        status: "CLOSED",
      },
    }),
    prisma.teamMembership.findMany({
      where: { editorProfileId },
      select: { status: true },
    }),
  ]);

  const workingWithAgencies = memberships.filter((membership) => COMPLETED_MEMBERSHIP_STATUSES.has(membership.status)).length;

  const payload: FreelancerDashboardPayload = {
    ok: true,
    trust,
    stats: {
      activeAssignments: appAssignments.filter((item) => !["COMPLETED", "PAYMENT_APPROVED", "PAID", "CANCELLED", "DISPUTED"].includes(item.status)).length,
      ...applicationStats,
      pendingPaymentRequests: pendingPaymentRequestCount,
      projectsDone: Math.max(completedProjects, appAssignments.filter((item) => ["COMPLETED", "PAYMENT_APPROVED", "PAID"].includes(item.status)).length),
      revisionRequests: revisionRequestCount,
      walletAvailable,
      workingWithAgencies: Math.max(workingWithAgencies, appMembershipCount),
      serviceViews,
    },
  };

  return NextResponse.json(payload);
}
