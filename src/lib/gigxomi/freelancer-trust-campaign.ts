import "server-only";

import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { calculateFreelancerTrustScore } from "@/lib/gigxomi/freelancer-onboarding-service";
import { listMobilePushTokens, sendMobilePushNotifications } from "@/lib/mobile-push-store";
import { prisma } from "@/lib/prisma";

const messages: Record<string, { title: string; body: string; deepLink: string; mobileDeepLink: string }> = {
  COMPLETE_SERVICE: { title: "Complete your editor service", body: "Add your editor category, offer and playable portfolio so Gigxomi can qualify your work.", deepLink: "/freelancer/onboarding", mobileDeepLink: "/onboarding" },
  COMPLETE_ASSESSMENT: { title: "Complete your editor qualification", body: "Finish your private ten-question assessment to establish your starting Trust Score.", deepLink: "/freelancer/onboarding", mobileDeepLink: "/onboarding" },
  COMPLETE_PROFILE: { title: "Put a complete profile behind your work", body: "Add the remaining profile details agencies need before they can trust the person behind the portfolio.", deepLink: "/freelancer/onboarding", mobileDeepLink: "/onboarding" },
  REVISE_PORTFOLIO: { title: "Your portfolio needs an update", body: "Open Gigxomi, review the Super Admin feedback and resubmit stronger work.", deepLink: "/freelancer/services", mobileDeepLink: "/service" },
  VERIFY_IDENTITY: { title: "Add the Gigxomi identity badge", body: "DigiLocker verification is optional and confirms identity only. Complete it to add 5 Trust Score points.", deepLink: "/freelancer/profile", mobileDeepLink: "/onboarding" },
  RESPOND_TO_ASSIGNMENT: { title: "An assignment is waiting for you", body: "A quick, clear accept or decline protects agency response confidence.", deepLink: "/freelancer/apply-for-work", mobileDeepLink: "/projects" },
  POST_PROGRESS_UPDATE: { title: "Keep your agency updated", body: "Share what is complete, any blocker and when the next milestone will be ready.", deepLink: "/freelancer/apply-for-work", mobileDeepLink: "/projects" },
  COMPLETE_RELIABLE_WORK: { title: "Build an established Trust Score", body: "Complete assigned work on time with clear progress updates to move beyond provisional status.", deepLink: "/freelancer/apply-for-work", mobileDeepLink: "/projects" },
};

export async function runFreelancerTrustCampaign() {
  const before = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const records = await prisma.appFreelancerOnboarding.findMany({
    where: { campaignOptOut: false, OR: [{ lastCampaignAt: null }, { lastCampaignAt: { lt: before } }] },
    select: { userId: true }, take: 100,
  });
  let sent = 0; let skipped = 0;
  for (const record of records) {
    const trust = await calculateFreelancerTrustScore(record.userId);
    const action = trust.nextAction ? messages[trust.nextAction] : null;
    if (!action) { skipped += 1; continue; }
    await createAppNotification({ userId: record.userId, type: "trust_improvement", title: action.title, message: action.body, entityType: "trust_score", metadata: { deepLinkUrl: action.deepLink, nextAction: trust.nextAction } });
    const tokens = await listMobilePushTokens({ activeOnly: true, userId: record.userId });
    if (tokens.length) await sendMobilePushNotifications(tokens, { title: action.title, body: action.body, data: { type: "TRUST_IMPROVEMENT", deepLinkUrl: action.mobileDeepLink, nextAction: trust.nextAction ?? "", notificationChannelId: "gigxomi-trust-score" } });
    await prisma.appFreelancerOnboarding.update({ where: { userId: record.userId }, data: { lastCampaignAt: new Date() } });
    sent += 1;
  }
  return { attempted: records.length, sent, skipped };
}
