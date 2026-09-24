import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getCurrentUserSubscription } from "@/lib/billing/billing-access-service";
import { getBillingEntitlementSnapshot } from "@/lib/billing/entitlement-state";
import { prisma } from "@/lib/prisma";
import { reconcileGatewayCheckout } from "@/lib/billing/gateway-checkout-service";

function serializeSubscription(
  subscription:
    | Awaited<ReturnType<typeof getCurrentUserSubscription>>
    | NonNullable<NonNullable<Awaited<ReturnType<typeof getBillingEntitlementSnapshot>>>["subscription"]>
    | null
    | undefined,
) {
  if (!subscription) {
    return null;
  }

  return {
    id: subscription.id,
    status: subscription.status,
    paymentStatus: subscription.paymentStatus,
    billingType: subscription.billingType,
    billingInterval: subscription.billingInterval,
    autoRenew: subscription.autoRenew,
    mandateStatus: subscription.mandateStatus,
    amount: Number(subscription.amount ?? 0),
    currency: subscription.package?.currency ?? "INR",
    startsAt: subscription.startsAt?.toISOString() ?? null,
    expiresAt: subscription.expiresAt?.toISOString() ?? null,
    renewsAt: subscription.renewsAt?.toISOString() ?? null,
    package: subscription.package
      ? {
          id: subscription.package.id,
          name: subscription.package.name,
          slug: subscription.package.slug,
          packageType: subscription.package.packageType,
          audience: subscription.package.packageType,
          priceLabel: null,
          billingLabel: null,
        }
      : null,
  };
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  if (authorization.session.role === "SUPER_ADMIN") {
    return NextResponse.json({
      ok: true,
      active: true,
      reason: "SUPER_ADMIN_BYPASS",
      subscription: null,
      packageStatus: authorization.session.packageStatus,
      packageName: authorization.session.packageName,
    });
  }

  try {
  let paymentRefreshPending = false;
  const pending = await prisma.paymentTransaction.findFirst({
    where: { userId: authorization.session.userId, provider: "PHONEPE", status: { in: ["INITIATED", "PENDING"] }, rawRequest: { path: ["checkoutVersion"], equals: 2 } },
    orderBy: { createdAt: "desc" },
  });
  if (pending?.merchantOrderId) {
    try { await reconcileGatewayCheckout(pending.merchantOrderId); } catch { paymentRefreshPending = true; }
  }
  const entitlement = await getBillingEntitlementSnapshot(authorization.session);
  const subscription = entitlement?.subscription ?? (await getCurrentUserSubscription(authorization.session.userId));
  const active = entitlement?.active === true || authorization.session.packageStatus === "ACTIVE";
  const isFreelancer = authorization.session.role === "FREELANCER" || authorization.session.assignedRole === "FREELANCER";
  const onboardingComplete = isFreelancer
    ? Boolean(entitlement?.onboarding?.completedAt || authorization.session.packageStatus === "ACTIVE")
    : Boolean(entitlement?.onboarding?.completedAt);
  const audience = isFreelancer ? "FREELANCER" : (entitlement?.audience ?? authorization.session.packageAudience);

  return NextResponse.json({
    ok: true,
    active,
    paymentRefreshPending,
    reason: active ? "ACTIVE" : subscription ? "PAYMENT_PENDING" : "PACKAGE_REQUIRED",
    onboardingComplete,
    dashboardReady: active && onboardingComplete,
    audience,
    entitlementState: entitlement?.entitlementState ?? (active ? "FREE_ACTIVE" : "NONE"),
    onboardingState: entitlement?.onboarding
      ? {
          stage: entitlement.onboarding.stage,
          profileDoneAt: entitlement.onboarding.profileDoneAt?.toISOString() ?? null,
          completedAt: entitlement.onboarding.completedAt?.toISOString() ?? null,
        }
      : null,
    latestTransaction: entitlement?.latestTransaction
      ? {
          id: entitlement.latestTransaction.id,
          status: entitlement.latestTransaction.status,
          transactionType: entitlement.latestTransaction.transactionType,
          updatedAt: entitlement.latestTransaction.updatedAt.toISOString(),
        }
      : null,
    subscription: serializeSubscription(subscription),
    packageStatus: active ? "ACTIVE" : entitlement?.entitlementState === "EXPIRED" ? "EXPIRED" : authorization.session.packageStatus,
    packageName: subscription?.package?.name ?? authorization.session.packageName,
    packageAudience: audience,
    packageExpiresAt: subscription?.expiresAt?.toISOString() ?? null,
  });
  } catch (error) {
    console.error("[mobile/subscription/status] Transient error refreshing plan, falling back to session entitlement:", error);
    const sessionActive =
      authorization.session.packageStatus === "ACTIVE" ||
      (authorization.session.packageStatus as string) === "TRIALING" ||
      (authorization.session.role as string) === "SUPER_ADMIN";

    return NextResponse.json({
      ok: true,
      active: sessionActive,
      paymentRefreshPending: false,
      reason: sessionActive ? "ACTIVE" : "PACKAGE_REQUIRED",
      onboardingComplete: true,
      dashboardReady: sessionActive,
      audience: authorization.session.packageAudience,
      entitlementState: sessionActive ? "PREMIUM_ACTIVE" : "NONE",
      onboardingState: null,
      latestTransaction: null,
      subscription: null,
      packageStatus: authorization.session.packageStatus,
      packageName: authorization.session.packageName,
      packageAudience: authorization.session.packageAudience,
      packageExpiresAt: authorization.session.packageExpiresAt ?? null,
    });
  }
}
