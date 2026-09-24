import "server-only";

import type { AppDripCampaign, AppAuthUser, ConnectedOnboardingState, Prisma } from "@prisma/client";

import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { listMobilePushTokens, sendMobilePushNotifications } from "@/lib/mobile-push-store";
import { prisma } from "@/lib/prisma";

type CandidateUser = AppAuthUser & { connectedOnboarding: ConnectedOnboardingState | null };

function audienceWhere(audiences: AppDripCampaign["audiences"]) {
  const filters = audiences.map((audience) => {
    if (audience === "CRM") return { role: "SALES_AGENT" as const };
    if (audience === "AGENCY") return { workspaceMode: "AGENCY" as const };
    return { assignedRole: "FREELANCER" as const };
  });
  return filters.length ? { OR: filters } : { id: "__none__" };
}

function onboardingPayload(state: ConnectedOnboardingState | null) {
  return state?.payload && typeof state.payload === "object" && !Array.isArray(state.payload) ? state.payload as Record<string, unknown> : {};
}

function isInsideLocalWindow(campaign: AppDripCampaign, user: CandidateUser) {
  const timezone = String(onboardingPayload(user.connectedOnboarding).timezone || "Asia/Kolkata");
  let current = "12:00";
  try {
    current = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  } catch {
    current = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  }
  return campaign.localWindowStart <= campaign.localWindowEnd
    ? current >= campaign.localWindowStart && current <= campaign.localWindowEnd
    : current >= campaign.localWindowStart || current <= campaign.localWindowEnd;
}

async function triggerState(campaign: AppDripCampaign, user: CandidateUser) {
  const delayCutoff = new Date(Date.now() - campaign.delayMinutes * 60_000);
  if (user.createdAt > delayCutoff) return null;
  if (campaign.trigger === "PROFILE_INCOMPLETE") {
    const state = user.connectedOnboarding;
    if (user.assignedRole === "FREELANCER") {
      const freelancerOnboarding = await prisma.appFreelancerOnboarding.findUnique({
        where: { userId: user.id },
        select: { completedAt: true },
      });
      if (freelancerOnboarding?.completedAt) return null;
    }
    return state && !state.profileDoneAt && state.updatedAt <= delayCutoff ? `profile:${state.stage}` : null;
  }
  if (campaign.trigger === "TRUST_SCORE_BELOW" || campaign.trigger === "SLOW_REPLY") {
    const snapshot = await prisma.appFreelancerTrustSnapshot.findUnique({ where: { userId: user.id } });
    if (!snapshot) return null;
    if (snapshot.calculatedAt > delayCutoff) return null;
    if (campaign.trigger === "TRUST_SCORE_BELOW") return snapshot.score < (campaign.threshold ?? 50) ? `trust:${snapshot.calculatedAt.toISOString().slice(0, 10)}` : null;
    return snapshot.responsePoints < (campaign.threshold ?? 4) ? `reply:${snapshot.calculatedAt.toISOString().slice(0, 10)}` : null;
  }
  if (campaign.trigger === "MISSED_WORK") {
    const assignment = await prisma.appAssignmentRecord.findFirst({
      where: { freelancerId: user.id, deadline: { lt: delayCutoff }, status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "REVISION_REQUESTED"] } },
      orderBy: { deadline: "asc" },
    });
    return assignment ? `assignment:${assignment.id}` : null;
  }
  if (campaign.trigger === "REQUIRED_LEARNING_INCOMPLETE") {
    const audience = user.role === "SALES_AGENT" ? "CRM" : user.workspaceMode === "AGENCY" ? "AGENCY" : "FREELANCER";
    const course = await prisma.salesTrainingCourse.findFirst({
      where: { isPublished: true, isRequired: true, audiences: { has: audience }, OR: [{ publishedAt: { lte: delayCutoff } }, { publishedAt: null, createdAt: { lte: delayCutoff } }] },
      include: { lessons: { where: { isRequired: true }, select: { id: true } } },
      orderBy: { sortOrder: "asc" },
    });
    if (!course?.lessons.length) return null;
    const completed = await prisma.salesTrainingProgress.count({
      where: { userId: user.id, courseId: course.id, lessonId: { in: course.lessons.map((item) => item.id) }, status: "COMPLETED" },
    });
    return completed < course.lessons.length ? `course:${course.id}` : null;
  }
  return null;
}

function render(template: string, user: CandidateUser) {
  return template.replaceAll("{{name}}", user.displayName).replaceAll("{{firstName}}", user.displayName.split(/\s+/)[0] || user.displayName);
}

export async function runConnectedDripCampaigns() {
  const campaigns = await prisma.appDripCampaign.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  const summary = { campaigns: campaigns.length, evaluated: 0, sent: 0, skipped: 0, failed: 0 };
  for (const campaign of campaigns) {
    const users = await prisma.appAuthUser.findMany({ where: audienceWhere(campaign.audiences), include: { connectedOnboarding: true }, take: 250 });
    for (const user of users) {
      summary.evaluated += 1;
      const reasonKey = await triggerState(campaign, user);
      if (!reasonKey || !isInsideLocalWindow(campaign, user)) {
        summary.skipped += 1;
        continue;
      }
      const sentCount = await prisma.appDripDelivery.count({ where: { campaignId: campaign.id, userId: user.id, status: "SENT" } });
      if (sentCount >= campaign.maxSendsPerUser) {
        summary.skipped += 1;
        continue;
      }
      const cooldownCutoff = new Date(Date.now() - campaign.cooldownMinutes * 60_000);
      const recent = await prisma.appDripDelivery.findFirst({ where: { campaignId: campaign.id, userId: user.id, status: "SENT", sentAt: { gte: cooldownCutoff } } });
      if (recent) {
        summary.skipped += 1;
        continue;
      }
      const bucket = Math.floor(Date.now() / Math.max(60_000, campaign.cooldownMinutes * 60_000));
      const triggerKey = `${reasonKey}:${bucket}`;
      const delivery = await prisma.appDripDelivery.upsert({
        where: { campaignId_userId_triggerKey: { campaignId: campaign.id, userId: user.id, triggerKey } },
        create: { campaignId: campaign.id, userId: user.id, triggerKey, scheduledAt: new Date(), metadata: { reasonKey } },
        update: {},
      });
      if (delivery.status !== "PENDING") continue;
      try {
        const title = render(campaign.titleTemplate, user);
        const body = render(campaign.bodyTemplate, user);
        const tokens = await listMobilePushTokens({ activeOnly: true, userId: user.id });
        const push = tokens.length
          ? await sendMobilePushNotifications(tokens, { title, body, data: { type: "drip", campaignId: campaign.id, deepLinkUrl: campaign.destination || "/notifications", notificationChannelId: "gigxomi-onboarding" } })
          : { sent: 0, failed: 0, results: [] };
        await createAppNotification({ userId: user.id, tenantId: user.tenantId, type: "drip_campaign", title, message: body, entityType: "drip_campaign", entityId: campaign.id });
        const deliveryStatus = push.sent > 0 || !tokens.length ? "SENT" : "FAILED";
        await prisma.appDripDelivery.update({
          where: { id: delivery.id },
          data: { status: deliveryStatus, sentAt: deliveryStatus === "SENT" ? new Date() : null, failedAt: deliveryStatus === "FAILED" ? new Date() : null, error: deliveryStatus === "FAILED" ? "Push provider rejected every token." : null, metadata: JSON.parse(JSON.stringify({ reasonKey, inAppNotification: true, push })) as Prisma.InputJsonObject },
        });
        if (deliveryStatus === "SENT") summary.sent += 1;
        else summary.failed += 1;
      } catch (error) {
        summary.failed += 1;
        await prisma.appDripDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", failedAt: new Date(), error: error instanceof Error ? error.message : "Campaign delivery failed." } });
      }
    }
  }
  return summary;
}
