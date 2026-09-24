import "server-only";

import { prisma } from "@/lib/prisma";

export type FreelancerPortfolioStatus = "NOT_STARTED" | "SUBMITTED" | "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export type FreelancerAdminProgress = {
  profileCompleted: boolean;
  portfolioStatus: FreelancerPortfolioStatus;
  onboardingCompleted: boolean;
};

export async function getFreelancerAdminProgress(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (!uniqueUserIds.length) {
    return {} as Record<string, FreelancerAdminProgress>;
  }

  const [onboardingRecords, portfolioReviews] = await Promise.all([
    prisma.appFreelancerOnboarding.findMany({
      where: { userId: { in: uniqueUserIds } },
      select: {
        userId: true,
        profileCompletedAt: true,
        serviceSubmittedAt: true,
        completedAt: true,
        status: true,
      },
    }),
    prisma.appFreelancerPortfolioReview.findMany({
      where: { freelancerId: { in: uniqueUserIds } },
      orderBy: { submittedAt: "desc" },
      select: { freelancerId: true, status: true },
    }),
  ]);

  const onboardingByUser = new Map(onboardingRecords.map((record) => [record.userId, record]));
  const latestPortfolioStatus = new Map<string, FreelancerPortfolioStatus>();
  for (const review of portfolioReviews) {
    if (latestPortfolioStatus.has(review.freelancerId)) continue;
    const status = review.status.toUpperCase();
    latestPortfolioStatus.set(
      review.freelancerId,
      status === "APPROVED" || status === "CHANGES_REQUESTED" || status === "REJECTED" ? status : "SUBMITTED",
    );
  }

  return uniqueUserIds.reduce<Record<string, FreelancerAdminProgress>>((result, userId) => {
    const onboarding = onboardingByUser.get(userId);
    result[userId] = {
      profileCompleted: Boolean(onboarding?.profileCompletedAt),
      portfolioStatus: latestPortfolioStatus.get(userId) ?? (onboarding?.serviceSubmittedAt ? "SUBMITTED" : "NOT_STARTED"),
      onboardingCompleted: Boolean(onboarding?.completedAt || onboarding?.status === "COMPLETED"),
    };
    return result;
  }, {});
}
