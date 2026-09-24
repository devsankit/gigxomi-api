import "server-only";

import type { SessionContext } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export type BillingEntitlementState =
  | "NONE"
  | "FREE_ACTIVE"
  | "MANDATE_PENDING"
  | "PREMIUM_ACTIVE"
  | "PAST_DUE"
  | "CANCELLED"
  | "EXPIRED";

export async function getBillingEntitlementSnapshot(session: SessionContext) {
  if (!session.userId) return null;

  const [subscriptions, onboarding] = await Promise.all([
    prisma.userSubscription.findMany({
      where: { userId: session.userId },
      include: {
        package: true,
        paymentTransactions: {
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: { id: true, status: true, transactionType: true, redirectUrl: true, updatedAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.connectedOnboardingState.findUnique({
      where: { userId: session.userId },
      select: { audience: true, stage: true, profileDoneAt: true, completedAt: true },
    }),
  ]);
  const now = new Date();
  const hasVerifiedAccess = (subscription: (typeof subscriptions)[number]) => {
    if (subscription.billingType === "FREE") {
      return subscription.paymentStatus === "NOT_REQUIRED" || subscription.status === "ACTIVE";
    }

    if (subscription.status === "ACTIVE" && (subscription.paymentStatus === "PAID" || subscription.paymentStatus === "NOT_REQUIRED")) {
      return true;
    }

    if (subscription.status === "ACTIVE" && (subscription.subscriptionState === "ADMIN_GRANTED" || subscription.subscriptionState === "RAZORPAY_ACTIVE")) {
      return true;
    }

    const providerPaymentVerified =
      subscription.paymentTransactions.some((item) => item.status === "SUCCESS");
    const ownerAuthorizedGrant =
      session.role === "ADMIN" &&
      subscription.package?.packageType === "AGENCY" &&
      (subscription.paymentStatus === "NOT_REQUIRED" || subscription.paymentStatus === "PAID") &&
      Boolean(subscription.expiresAt && subscription.expiresAt > now);

    return providerPaymentVerified || ownerAuthorizedGrant;
  };

  const isFreelancerRole = session.role === "FREELANCER" || session.assignedRole === "FREELANCER";
  const matchingSubscriptions = isFreelancerRole
    ? subscriptions.filter((item) => item.packageType === "FREELANCER" || item.package?.packageType === "FREELANCER")
    : subscriptions;
  const candidateSubscriptions = matchingSubscriptions.length > 0 ? matchingSubscriptions : subscriptions;

  // Starting an upgrade must not suspend an already paid or free current period.
  const activeSubscription = candidateSubscriptions.find((item) =>
    ["ACTIVE", "TRIALING"].includes(item.status) && (!item.expiresAt || item.expiresAt > now) && hasVerifiedAccess(item)
  );
  const subscription = activeSubscription ?? candidateSubscriptions[0] ?? null;

  const audience =
    isFreelancerRole
      ? "FREELANCER"
      : (onboarding?.audience ??
        (session.packageAudience === "AGENCY" || session.workspaceMode === "AGENCY" || session.role === "ADMIN"
          ? "AGENCY"
          : "FREELANCER"));
  const packageIsFree = subscription?.billingType === "FREE" || (session.packageAudience === "FREELANCER" && !session.packageId?.includes("premium"));
  const paymentVerified = Boolean(subscription && hasVerifiedAccess(subscription));
  const status = subscription?.status ?? null;
  const paidPeriodEnded = Boolean(subscription?.expiresAt && subscription.expiresAt <= now);
  let entitlementState: BillingEntitlementState = "NONE";

  if ((status === "ACTIVE" || status === "TRIALING") && paidPeriodEnded) {
    entitlementState = "EXPIRED";
  } else if ((status === "ACTIVE" || status === "TRIALING") && paymentVerified) {
    entitlementState = packageIsFree ? "FREE_ACTIVE" : "PREMIUM_ACTIVE";
  } else if (session.packageStatus === "ACTIVE" && (!session.packageExpiresAt || new Date(session.packageExpiresAt) > now)) {
    entitlementState =
      session.packageAudience === "FREELANCER" || session.packageId?.toLowerCase().includes("freemium")
        ? "FREE_ACTIVE"
        : "PREMIUM_ACTIVE";
  } else if (status === "PENDING" || status === "PAUSED" || session.packageStatus === "PAUSED") {
    entitlementState = "MANDATE_PENDING";
  } else if (status === "PAST_DUE") {
    entitlementState = "PAST_DUE";
  } else if (status === "CANCELLED" || status === "REVOKED") {
    entitlementState = "CANCELLED";
  } else if (status === "EXPIRED" || session.packageStatus === "EXPIRED") {
    entitlementState = "EXPIRED";
  }

  return {
    audience,
    entitlementState,
    active:
      entitlementState === "FREE_ACTIVE" ||
      entitlementState === "PREMIUM_ACTIVE" ||
      (entitlementState === "PAST_DUE" && Boolean(subscription?.graceEndsAt && subscription.graceEndsAt > now)) ||
      (entitlementState === "CANCELLED" && Boolean(subscription?.expiresAt && subscription.expiresAt > now)),
    subscription,
    onboarding,
    latestTransaction: subscriptions[0]?.paymentTransactions[0] ?? null,
  };
}
