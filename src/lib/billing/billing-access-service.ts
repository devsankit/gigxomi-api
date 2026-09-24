import "server-only";

import { cache } from "react";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getSessionContext } from "@/lib/auth/session";

const ACTIVE_STATUSES = ["ACTIVE", "TRIALING"] as const;

export const getCurrentUserSubscription = cache(async (userId: string) => {
  const subscriptions = await prisma.userSubscription.findMany({
    where: {
      userId,
      AND: [{ OR: [
        { status: { in: [...ACTIVE_STATUSES] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        { status: { in: ["CANCELLED", "REVOKED"] }, expiresAt: { gt: new Date() } },
        { status: "PAST_DUE", graceEndsAt: { gt: new Date() } },
      ] }],
    },
    include: {
      package: true,
      paymentTransactions: {
        where: { status: "SUCCESS" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  const now = new Date();
  for (const subscription of subscriptions) {
    if (subscription.billingType === "FREE") {
      if (subscription.paymentStatus === "NOT_REQUIRED" || subscription.status === "ACTIVE") {
        return subscription;
      }
    }
    if (subscription.status === "ACTIVE" && (subscription.paymentStatus === "PAID" || subscription.paymentStatus === "NOT_REQUIRED")) {
      return subscription;
    }
    if (subscription.status === "ACTIVE" && (subscription.subscriptionState === "ADMIN_GRANTED" || subscription.subscriptionState === "RAZORPAY_ACTIVE")) {
      return subscription;
    }
    if (subscription.paymentTransactions.length > 0) {
      return subscription;
    }
    if (subscription.package?.packageType === "AGENCY" && (subscription.paymentStatus === "NOT_REQUIRED" || subscription.paymentStatus === "PAID") && Boolean(subscription.expiresAt && subscription.expiresAt > now)) {
      return subscription;
    }
  }

  return null;
});

type EffectiveBillingResult = {
  subscription: Awaited<ReturnType<typeof getCurrentUserSubscription>>;
  package: NonNullable<Awaited<ReturnType<typeof getCurrentUserSubscription>>>["package"] | NonNullable<Awaited<ReturnType<typeof prisma.package.findUnique>>>;
} | null;

const billingPackageCache = new Map<string, { expiresAt: number; result: EffectiveBillingResult }>();

export function invalidateBillingPackageCache(userId?: string) {
  if (userId) {
    billingPackageCache.delete(userId);
  } else {
    billingPackageCache.clear();
  }
}

export const getEffectiveBillingPackageForUser = cache(async (userId: string) => {
  const now = Date.now();
  const cached = billingPackageCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const subscription = await getCurrentUserSubscription(userId);
  if (subscription?.package) {
    const result: EffectiveBillingResult = { subscription, package: subscription.package };
    billingPackageCache.set(userId, { expiresAt: now + 60_000, result });
    return result;
  }

  const user = await prisma.appAuthUser.findUnique({
    where: { id: userId },
    select: {
      packageId: true,
      packageStatus: true,
      packageExpiresAt: true,
      role: true,
      assignedRole: true,
    },
  });
  if (!user?.packageId || user.packageStatus !== "ACTIVE" || (user.packageExpiresAt && user.packageExpiresAt <= new Date())) {
    billingPackageCache.set(userId, { expiresAt: now + 10_000, result: null });
    return null;
  }

  const fallbackPackage = await prisma.package.findUnique({ where: { id: user.packageId } });
  if (fallbackPackage) {
    const result: EffectiveBillingResult = { subscription: null, package: fallbackPackage };
    billingPackageCache.set(userId, { expiresAt: now + 60_000, result });
    return result;
  }

  billingPackageCache.set(userId, { expiresAt: now + 10_000, result: null });
  return null;
});

export async function requireActiveBillingAccess() {
  const session = await getSessionContext();
  if (session.role === "GUEST" || !session.userId) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 }) };
  }

  if (session.role === "SUPER_ADMIN" || session.role === "FREELANCER") {
    return { ok: true as const, session, subscription: null };
  }

  const effective = await getEffectiveBillingPackageForUser(session.userId);
  if (!effective) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "An active subscription is required." }, { status: 402 }) };
  }

  return { ok: true as const, session, subscription: effective.subscription };
}

export async function requireActiveBillingPageAccess() {
  const session = await getSessionContext();
  if (session.role === "SUPER_ADMIN" || session.role === "FREELANCER") {
    return;
  }
  if (session.role === "GUEST" || !session.userId) {
    redirect("/login");
  }
  const effective = await getEffectiveBillingPackageForUser(session.userId);
  if (!effective) {
    redirect("/subscription-required?error=An%20active%20subscription%20is%20required%20to%20continue.");
  }
}

type PlanLimitKey =
  | "activeProjectLimit"
  | "clientLimit"
  | "editorFreelancerLimit"
  | "portfolioItemLimit"
  | "serviceLimit"
  | "staffAccountLimit"
  | "teamMemberLimit";

export async function assertPlanLimit(input: { userId: string; limitKey: PlanLimitKey; currentCount: number; label?: string }) {
  const effectivePackage = await getEffectiveBillingPackageForUser(input.userId);
  if (!effectivePackage) {
    return { ok: false as const, error: "Active subscription required." };
  }
  const limit = effectivePackage.package[input.limitKey];
  if (typeof limit === "number" && limit >= 0 && input.currentCount >= limit) {
    return {
      ok: false as const,
      error: `${input.label ?? "Your current package"} limit has been reached (${input.currentCount}/${limit}). Upgrade the package or remove inactive records.`,
      limit,
    };
  }
  return { ok: true as const, limit: typeof limit === "number" ? limit : null };
}
