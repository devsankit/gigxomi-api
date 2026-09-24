import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { getDashboardPathForIdentity } from "@/lib/auth/session";
import { findRegistrationPackage } from "@/lib/gigxomi/public-growth-store";
import {
  getWhatsAppConnectionStateFromFile,
  sendStandaloneWhatsAppCallToActionTemplateFromFile,
  sendStandaloneWhatsAppMessageFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import type { ManagedAuthUser } from "@/lib/auth/types";
import type { RegistrationPackage } from "@/lib/gigxomi/public-growth-types";
import { getRegistrationPackageBillingType, isRegistrationPackageFree } from "@/lib/billing/package-billing";
import { ensurePersistedRegistrationPackage } from "@/lib/billing/package-service";
import { buildUpiPaymentUri, getManualUpiAdminConfig } from "@/lib/billing/manual-upi-config-service";
import { assertPhonePeCapabilityEnabled } from "@/lib/billing/phonepe-admin-config-service";
import { PhonePeMandateAutopayProvider, PhonePeStandardCheckoutProvider } from "@/lib/billing/phonepe-providers";
import { trackSalesReferralEvent } from "@/lib/gigxomi/sales-store";
import { companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";
import { markSubscriptionCouponRedeemed } from "@/lib/connected-platform/coupons";

type DbUser = Awaited<ReturnType<typeof prisma.appAuthUser.findUnique>>;

const DEFAULT_TENANT_ID = "tenant-gigxomi";

function id(prefix: string) {
  return `${prefix}-${randomBytes(10).toString("hex")}`;
}

function mapPackageType(pkg: RegistrationPackage) {
  return pkg.audience === "AGENCY" ? "AGENCY" : "FREELANCER";
}

function nextBillingDate(interval: string | undefined, from = new Date()) {
  const date = new Date(from);
  if (interval === "YEARLY") date.setFullYear(date.getFullYear() + 1);
  else if (interval === "QUARTERLY") date.setMonth(date.getMonth() + 3);
  else if (interval === "MONTHLY") date.setMonth(date.getMonth() + 1);
  else date.setFullYear(date.getFullYear() + 10);
  return date;
}

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL?.trim() || companyKnowledgeBase.siteUrl).replace(/\/+$/, "");
}

function buildManualPaymentPath(transactionId: string) {
  return `/payment/${transactionId}`;
}

function buildManualPaymentUrl(transactionId: string) {
  return `${getAppBaseUrl()}${buildManualPaymentPath(transactionId)}`;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return Number(value) || 0;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value ?? 0) || 0;
}

function getFirstAndLastName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts.slice(1).join(" ")}` : displayName.trim();
}

function readManualPaymentPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const paymentMode = record.paymentMode === "SUPPORT_ONLY" ? "SUPPORT_ONLY" : "UPI_QR";
  const upiId = typeof record.upiId === "string" ? record.upiId.trim() : "";
  const payeeName = typeof record.payeeName === "string" ? record.payeeName.trim() : "";
  const upiUri = typeof record.upiUri === "string" ? record.upiUri.trim() : "";
  const paymentReference = typeof record.paymentReference === "string" ? record.paymentReference.trim() : "";
  const supportWhatsApp = typeof record.supportWhatsApp === "string" ? record.supportWhatsApp.trim() : "";
  const instructions = typeof record.instructions === "string" ? record.instructions.trim() : "";

  if (!paymentReference && !upiId && !supportWhatsApp) {
    return null;
  }

  return {
    paymentMode,
    upiId,
    payeeName,
    upiUri,
    paymentReference,
    supportWhatsApp,
    instructions,
  };
}

function buildManualPaymentRequest(input: {
  amount: number;
  currency: string;
  packageId: string;
  packageName: string;
  paymentReference: string;
  subscriptionId: string;
  supportWhatsApp: string;
  instructions: string;
  paymentMode: "UPI_QR" | "SUPPORT_ONLY";
  upiId?: string;
  payeeName?: string;
  upiUri?: string;
}) {
  return {
    amount: input.amount,
    currency: input.currency,
    packageId: input.packageId,
    packageName: input.packageName,
    paymentReference: input.paymentReference,
    subscriptionId: input.subscriptionId,
    supportWhatsApp: input.supportWhatsApp,
    instructions: input.instructions,
    paymentMode: input.paymentMode,
    upiId: input.upiId ?? "",
    payeeName: input.payeeName ?? "",
    upiUri: input.upiUri ?? "",
  };
}

async function findPendingPaymentTransaction(input: {
  userId: string;
  packageId: string;
  subscriptionId?: string | null;
  provider: "PHONEPE" | "UPI_MANUAL";
}) {
  return prisma.paymentTransaction.findFirst({
    where: {
      userId: input.userId,
      packageId: input.packageId,
      provider: input.provider,
      status: { in: ["PENDING", "INITIATED"] },
      ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function ensureManualPaymentWhatsAppSent(input: {
  transactionId: string;
  paymentUrl: string;
  packageName: string;
  amount: number;
  paymentReference?: string;
  userDisplayName: string;
  userPhone: string;
}) {
  const alreadySent = await prisma.paymentLog.findFirst({
    where: { transactionId: input.transactionId, eventType: "manual_upi_whatsapp_sent" },
    orderBy: { createdAt: "desc" },
  });

  if (alreadySent) {
    return;
  }

  const tenantId = "tenant-gigxomi";
  const whatsappConnection = await getWhatsAppConnectionStateFromFile(tenantId).catch(() => null);
  const templateName = whatsappConnection?.subscriptionPaymentTemplateName?.trim() || "";
  const templateLanguage = whatsappConnection?.subscriptionPaymentTemplateLanguage?.trim() || "en_US";
  const firstName = getFirstAndLastName(input.userDisplayName);
  const formattedAmount = `INR ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: input.amount % 1 === 0 ? 0 : 2,
  }).format(input.amount)}`;
  const message = [
    `Hi ${firstName}, congratulations for selecting ${input.packageName} on Gigxomi.`,
    `Complete your subscription by paying INR ${input.amount.toFixed(2)} using this payment link: ${input.paymentUrl}`,
    `After payment, send the screenshot or UTR on WhatsApp for approval.`,
  ].join("\n\n");
  const delivery =
    templateName
      ? await sendStandaloneWhatsAppCallToActionTemplateFromFile({
          tenantId,
          to: input.userPhone,
          templateName,
          languageCode: templateLanguage,
          bodyVariables: [firstName, input.packageName, formattedAmount, input.paymentReference?.trim() || input.transactionId],
          buttonUrlVariable: input.paymentUrl,
        }).catch((error) => ({
          ok: false,
          mode: "whatsapp-failed" as const,
          error: error instanceof Error ? error.message : "WhatsApp template send failed",
        }))
      : await sendStandaloneWhatsAppMessageFromFile({
          tenantId,
          to: input.userPhone,
          body: message,
        }).catch((error) => ({
          ok: false,
          mode: "whatsapp-failed" as const,
          error: error instanceof Error ? error.message : "WhatsApp send failed",
        }));
  await prisma.paymentLog.create({
    data: {
      transactionId: input.transactionId,
      eventType: "manual_upi_whatsapp_sent",
      status: delivery.ok ? delivery.mode : "failed",
      payload: {
        paymentUrl: input.paymentUrl,
        message,
        templateName,
        templateLanguage,
        delivery,
      },
    },
  });
}

async function safeEnsureManualPaymentWhatsAppSent(input: {
  transactionId: string;
  paymentUrl: string;
  packageName: string;
  amount: number;
  paymentReference?: string;
  userDisplayName: string;
  userPhone: string;
}) {
  try {
    await ensureManualPaymentWhatsAppSent(input);
  } catch (error) {
    console.error("[billing] Manual UPI WhatsApp send/log failed", {
      transactionId: input.transactionId,
      packageName: input.packageName,
      userPhone: input.userPhone,
      error: error instanceof Error ? error.message : "Unknown WhatsApp error",
    });
  }
}

function toManagedUser(user: NonNullable<DbUser>): ManagedAuthUser {
  return {
    id: user.id,
    role: user.role,
    assignedRole: user.assignedRole,
    tenantId: user.tenantId,
    displayName: user.displayName,
    email: user.email ?? "",
    phone: user.phone,
    packageId: user.packageId,
    packageName: user.packageName,
    packageAudience: user.packageAudience,
    packageStatus: user.packageStatus,
    packageExpiresAt: user.packageExpiresAt?.toISOString() ?? null,
    workspaceMode: user.workspaceMode,
    isSeeded: user.isSeeded,
    createdAt: user.createdAt.toISOString(),
    createdByUserId: user.createdByUserId,
    lastLoginAt: user.lastLoginAt?.toISOString(),
    lastOtpSentAt: user.lastOtpSentAt?.toISOString(),
  };
}

async function getUserOrThrow(userId: string) {
  const user = await prisma.appAuthUser.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found.");
  return user;
}

async function getPackageOrThrow(packageId: string) {
  const pkg = await findRegistrationPackage(packageId);
  if (!pkg) throw new Error("Package not found.");
  if (!pkg.isActive || pkg.allowRegistration === false) throw new Error("Package is not available.");
  return ensurePersistedRegistrationPackage(pkg);
}

async function syncUserPackageAccess(input: {
  userId: string;
  pkg: RegistrationPackage;
  status: "ACTIVE" | "PAUSED" | "EXPIRED";
  startsAt?: Date | null;
  expiresAt?: Date | null;
}) {
  const assignedRole = input.pkg.audience === "AGENCY" ? "ADMIN" : "FREELANCER";
  const current = await getUserOrThrow(input.userId);
  const tenantId =
    input.pkg.audience === "AGENCY"
      ? current.tenantId && current.tenantId !== DEFAULT_TENANT_ID
        ? current.tenantId
        : `tenant-agency-${randomBytes(4).toString("hex")}`
      : DEFAULT_TENANT_ID;
  const updated = await prisma.appAuthUser.update({
    where: { id: input.userId },
    data: {
      assignedRole,
      // Billing state must never rewrite account identity. Access middleware
      // gates inactive packages; role and workspace keep the registration
      // audience stable so an Agency cannot see Freelancer plans while a
      // PhonePe mandate is pending.
      role: assignedRole,
      tenantId,
      packageId: input.pkg.id,
      packageName: input.pkg.name,
      packageAudience: input.pkg.audience,
      packageStatus: input.status,
      packageExpiresAt: input.expiresAt ?? null,
      workspaceMode: input.pkg.audience === "AGENCY" ? "AGENCY" : "FREELANCER",
      permissions: [assignedRole.toLowerCase()],
    },
  });
  return toManagedUser(updated);
}

export async function createOrUpdatePendingSubscription(input: {
  userId: string;
  packageId: string;
  provider?: "PHONEPE" | "UPI_MANUAL";
  amountOverride?: number;
  billingIntervalOverride?: "MONTHLY" | "YEARLY";
  renewalAmountOverride?: number;
  couponDiscountDuration?: "FIRST_CYCLE" | "RECURRING";
  paymentMode?: "UPI_INTENT" | "UPI_COLLECT";
  upiVpa?: string | null;
}) {
  const pkg = await getPackageOrThrow(input.packageId);
  const user = await getUserOrThrow(input.userId);
  const existing = await prisma.userSubscription.findFirst({
    where: { userId: input.userId, packageId: pkg.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  const billingType = getRegistrationPackageBillingType(pkg);
  const billingInterval =
    billingType === "FREE"
      ? "CUSTOM"
      : input.billingIntervalOverride ?? pkg.billingInterval ?? (billingType === "ONE_TIME_PAID" ? "ONE_TIME" : "MONTHLY");
  const amount = input.amountOverride == null ? pkg.amount ?? 0 : Math.max(0, input.amountOverride);
  const standardCycleAmount =
    billingInterval === "YEARLY" ? toNumber(pkg.priceYearly ?? pkg.amount) : toNumber(pkg.priceMonthly ?? pkg.amount);
  const renewalAmount =
    input.renewalAmountOverride == null
      ? input.couponDiscountDuration === "RECURRING"
        ? amount
        : standardCycleAmount || amount
      : Math.max(0, input.renewalAmountOverride);
  const common = {
    userId: user.id,
    packageId: pkg.id,
    packageType: mapPackageType(pkg),
    provider: billingType === "FREE" ? null : input.provider ?? "UPI_MANUAL",
    billingType,
    billingInterval,
    status: "PENDING",
    paymentStatus: billingType === "FREE" ? "NOT_REQUIRED" : "PENDING",
    autoRenew: billingType === "RECURRING" && pkg.autoRenewEnabled !== false,
    amount,
    renewalAmount: billingType === "RECURRING" ? renewalAmount : null,
    couponDiscountDuration: input.couponDiscountDuration ?? null,
    maxAmount: billingType === "RECURRING" ? Math.max(amount, renewalAmount) : null,
    frequency: billingInterval,
    amountType: "FIXED",
    autoDebit: billingType === "RECURRING",
    graceEndsAt: pkg.gracePeriodDays ? new Date(Date.now() + pkg.gracePeriodDays * 24 * 60 * 60 * 1000) : null,
  } as const;

  const subscription = existing
    ? await prisma.userSubscription.update({ where: { id: existing.id }, data: common })
    : await prisma.userSubscription.create({ data: common });

  let managedUser: ManagedAuthUser;
  try {
    managedUser = await syncUserPackageAccess({ userId: user.id, pkg, status: billingType === "FREE" ? "ACTIVE" : "PAUSED" });
  } catch (error) {
    if (billingType === "FREE") {
      throw error;
    }

    console.error("[billing] Pending subscription package sync failed; continuing with Manual UPI session creation", {
      packageId: pkg.id,
      subscriptionId: subscription.id,
      userId: user.id,
      error: error instanceof Error ? error.message : "Unknown pending subscription sync error",
    });
    managedUser = toManagedUser(await getUserOrThrow(user.id));
  }

  return { subscription, pkg, user: managedUser };
}

export async function activateSubscription(input: {
  subscriptionId: string;
  verifiedTransactionId?: string;
  providerState?: string;
  providerPayload?: unknown;
}) {
  const subscription = await prisma.userSubscription.findUnique({ where: { id: input.subscriptionId } });
  if (!subscription) throw new Error("Subscription not found.");
  const pkg = await getPackageOrThrow(subscription.packageId);
  if (subscription.billingType !== "FREE") {
    if (!input.verifiedTransactionId) {
      throw new Error("Paid subscription activation requires a verified payment transaction.");
    }
    const verifiedPayment = await prisma.paymentTransaction.findUnique({ where: { id: input.verifiedTransactionId } });
    if (
      !verifiedPayment ||
      verifiedPayment.status !== "SUCCESS" ||
      verifiedPayment.subscriptionId !== subscription.id ||
      verifiedPayment.userId !== subscription.userId ||
      verifiedPayment.packageId !== subscription.packageId ||
      toNumber(verifiedPayment.amount) !== toNumber(subscription.amount)
    ) {
      throw new Error("Verified payment does not match this subscription.");
    }
    if (subscription.billingType === "RECURRING" && !["MONTHLY", "YEARLY"].includes(subscription.billingInterval)) {
      throw new Error("Recurring subscription billing cycle is invalid.");
    }
  }
  if ((subscription.status === "ACTIVE" || subscription.status === "TRIALING") && subscription.startsAt) {
    return { subscription, pkg, user: toManagedUser(await getUserOrThrow(subscription.userId)) };
  }
  if (["EXPIRED", "CANCELLED", "REVOKED"].includes(subscription.status)) {
    throw new Error("This checkout is no longer eligible for activation. Choose a current plan to continue.");
  }
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + Math.max(1, pkg.durationDays || 30) * 24 * 60 * 60 * 1000);
  const renewsAt = subscription.billingType === "RECURRING" ? nextBillingDate(subscription.billingInterval, startsAt) : null;
  const updated = await prisma.userSubscription.update({
    where: { id: subscription.id },
    data: {
      status: subscription.billingType === "RECURRING" && pkg.trialEnabled && pkg.trialDays ? "TRIALING" : "ACTIVE",
      paymentStatus: subscription.billingType === "FREE" ? "NOT_REQUIRED" : "PAID",
      startsAt,
      expiresAt,
      renewsAt,
      nextBillingDate: renewsAt,
      subscriptionState: input.providerState ?? subscription.subscriptionState,
    },
  });
  await prisma.subscriptionStatusHistory.create({
    data: {
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: updated.status,
      reason: "activated_after_verified_billing",
      payload: input.providerPayload === undefined ? undefined : (input.providerPayload as object),
    },
  });
  const user = await syncUserPackageAccess({ userId: subscription.userId, pkg, status: "ACTIVE", startsAt, expiresAt: expiresAt ?? renewsAt ?? null });
  await markSubscriptionCouponRedeemed(subscription.id);
  const connectedOnboarding = await prisma.connectedOnboardingState.findUnique({ where: { userId: subscription.userId }, select: { audience: true, stage: true } });
  if (connectedOnboarding?.stage === "PAYMENT") {
    await prisma.connectedOnboardingState.update({
      where: { userId: subscription.userId },
      data: { activatedAt: new Date(), stage: "PROFILE" },
    });
  }
  if (updated.paymentStatus === "PAID") {
    const paidAmount = Number(updated.amount ?? pkg.priceMonthly ?? 0);
    if (paidAmount > 0) {
      try {
        const { recordReferralSubscription } = await import("@/lib/referrals/freelancer-referral-service");
        await recordReferralSubscription(subscription.userId, {
          packageName: pkg.name,
          amount: paidAmount,
          billingCycle: updated.billingInterval === "YEARLY" ? "yearly" : "monthly",
        });
      } catch (refSubErr) {
        console.error("[FREELANCER_REFERRALS] Subscription commission recording error:", refSubErr);
      }
    }
  }

  return { subscription: updated, pkg, user };
}

export async function activateFreeSubscription(userId: string, packageId: string, amountOverride?: number) {
  // Choosing a free tier is an explicit cancellation of unfinished paid
  // checkout state. A delayed mandate callback must not silently upgrade the
  // account after this point.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${userId}`}))::text`;
    await tx.paymentTransaction.updateMany({
      where: { userId, transactionType: { in: ["SETUP", "ONE_TIME"] }, status: { in: ["PENDING", "INITIATED"] } },
      data: { status: "EXPIRED" },
    });
    await tx.userSubscription.updateMany({
      where: { userId, status: "PENDING", packageId: { not: packageId } },
      data: { status: "EXPIRED", paymentStatus: "FAILED", mandateStatus: "EXPIRED" },
    });
  });
  const { subscription } = await createOrUpdatePendingSubscription({ userId, packageId, amountOverride });
  return activateSubscription({ subscriptionId: subscription.id, providerState: "FREE" });
}

export async function startOneTimePayment(input: {
  userId: string;
  packageId: string;
  salesReferralCode?: string;
  amountOverride?: number;
  billingIntervalOverride?: "MONTHLY" | "YEARLY";
}) {
  await assertPhonePeCapabilityEnabled("one_time");

  const { subscription, pkg, user } = await createOrUpdatePendingSubscription({
    ...input,
    provider: "PHONEPE",
  });
  const amount = input.amountOverride == null ? toNumber(pkg.amount) : Math.max(0, input.amountOverride);
  const currency = pkg.currency ?? "INR";
  const billingCycle = subscription.billingInterval;
  let existing = await findPendingPaymentTransaction({
    userId: user.id,
    packageId: pkg.id,
    provider: "PHONEPE",
    subscriptionId: subscription.id,
  });
  const existingRequest =
    existing?.rawRequest && typeof existing.rawRequest === "object" && !Array.isArray(existing.rawRequest)
      ? (existing.rawRequest as Record<string, unknown>)
      : null;
  if (
    existing &&
    (toNumber(existing.amount) !== amount ||
      (typeof existingRequest?.billingCycle === "string" && existingRequest.billingCycle !== billingCycle))
  ) {
    await prisma.paymentTransaction.update({ where: { id: existing.id }, data: { status: "EXPIRED" } });
    existing = null;
  }
  const existingRedirectUrl = existing?.redirectUrl?.trim() ?? "";
  const existingCreatedAtMs = existing?.createdAt ? new Date(existing.createdAt).getTime() : 0;
  const existingStillFresh = existingCreatedAtMs > Date.now() - 18 * 60 * 1000;

  if (existing && existingRedirectUrl && existingStillFresh) {
    if (input.salesReferralCode) {
      const normalizedSalesCode = input.salesReferralCode.trim().toUpperCase();
      const rawRequestRecord = existing.rawRequest && typeof existing.rawRequest === "object" && !Array.isArray(existing.rawRequest) ? existing.rawRequest : {};
      await prisma.paymentTransaction.update({
        where: { id: existing.id },
        data: {
          rawRequest: { ...(rawRequestRecord as Record<string, unknown>), salesReferralCode: normalizedSalesCode },
        },
      });
      await trackSalesReferralEvent({
        code: normalizedSalesCode,
        eventType: "PAYMENT_STARTED",
        packageId: pkg.id,
        userId: user.id,
        paymentTransactionId: existing.id,
        eventKey: `payment-started:${existing.id}`,
        metadata: { reused: true, provider: "PHONEPE", amount },
      }).catch((error) => {
        console.error("[sales] Referral PhonePe payment-start tracking failed", {
          transactionId: existing.id,
          error: error instanceof Error ? error.message : "Unknown referral tracking error",
        });
      });
    }
    console.info("[billing] Reusing pending PhonePe checkout", {
      packageId: pkg.id,
      subscriptionId: subscription.id,
      transactionId: existing.id,
      userId: user.id,
    });
    const managedUser = await getManagedUserForSession(user.id);
    return { redirectUrl: existingRedirectUrl, transactionId: existing.id, user: managedUser };
  }

  if (existing && !existingStillFresh) {
    await prisma.paymentTransaction.update({
      where: { id: existing.id },
      data: { status: "EXPIRED" },
    });
  }

  const merchantOrderId = id("gx-pe");
  const provider = new PhonePeStandardCheckoutProvider();
  const transaction = await prisma.paymentTransaction.create({
    data: {
      userId: user.id,
      packageId: pkg.id,
      subscriptionId: subscription.id,
      provider: "PHONEPE",
      transactionType: "ONE_TIME",
      merchantTransactionId: merchantOrderId,
      merchantOrderId,
      amount,
      currency,
      status: "INITIATED",
      rawRequest: {
        merchantOrderId,
        amount,
        currency,
        packageId: pkg.id,
        subscriptionId: subscription.id,
        billingCycle,
        ...(input.salesReferralCode ? { salesReferralCode: input.salesReferralCode.trim().toUpperCase() } : {}),
      },
      redirectUrl: null,
    },
  });

  try {
    const checkout = await provider.initiate({
      userId: user.id,
      userName: user.displayName,
      phone: user.phone,
      email: user.email,
      package: { ...pkg, billingInterval: billingCycle },
      subscriptionId: subscription.id,
      merchantOrderId,
      merchantTransactionId: merchantOrderId,
      amount,
      currency,
    });

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        transactionId: checkout.providerReference ?? null,
        rawResponse: checkout.raw as object,
        redirectUrl: checkout.redirectUrl,
      },
    });
    if (input.salesReferralCode) {
      await trackSalesReferralEvent({
        code: input.salesReferralCode,
        eventType: "PAYMENT_STARTED",
        packageId: pkg.id,
        userId: user.id,
        paymentTransactionId: transaction.id,
        eventKey: `payment-started:${transaction.id}`,
        metadata: { amount, provider: "PHONEPE" },
      }).catch((trackingError) => {
        console.error("[sales] Referral PhonePe payment-start tracking failed", {
          transactionId: transaction.id,
          error: trackingError instanceof Error ? trackingError.message : "Unknown referral tracking error",
        });
      });
    }

    const managedUser = await getManagedUserForSession(user.id);
    return { redirectUrl: checkout.redirectUrl, transactionId: transaction.id, user: managedUser };
  } catch (error) {
    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: "FAILED",
        rawResponse: {
          error: error instanceof Error ? error.message : "PhonePe checkout failed",
        },
      },
    });
    throw error;
  }
}

export async function startManualUpiPaymentSession(input: {
  userId: string;
  packageId: string;
  sendWhatsApp?: boolean;
  salesReferralCode?: string;
  amountOverride?: number;
  billingIntervalOverride?: "MONTHLY" | "YEARLY";
}) {
  const { subscription, pkg, user } = await createOrUpdatePendingSubscription(input);
  const amount = input.amountOverride == null ? toNumber(pkg.amount) : Math.max(0, input.amountOverride);
  const currency = pkg.currency ?? "INR";
  let existing = await findPendingPaymentTransaction({
    userId: user.id,
    packageId: pkg.id,
    provider: "UPI_MANUAL",
    subscriptionId: subscription.id,
  });
  if (existing && toNumber(existing.amount) !== amount) {
    await prisma.paymentTransaction.update({ where: { id: existing.id }, data: { status: "EXPIRED" } });
    existing = null;
  }
  const existingPayload = readManualPaymentPayload(existing?.rawRequest);
  const existingPaymentUrl = existing ? buildManualPaymentUrl(existing.id) : null;

  if (existing && existingPayload) {
    if (input.salesReferralCode) {
      const normalizedSalesCode = input.salesReferralCode.trim().toUpperCase();
      const rawRequestRecord = existing.rawRequest && typeof existing.rawRequest === "object" && !Array.isArray(existing.rawRequest) ? existing.rawRequest : {};
      await prisma.paymentTransaction.update({
        where: { id: existing.id },
        data: {
          rawRequest: { ...(rawRequestRecord as Record<string, unknown>), salesReferralCode: normalizedSalesCode },
        },
      });
      await trackSalesReferralEvent({
        code: normalizedSalesCode,
        eventType: "PAYMENT_STARTED",
        packageId: pkg.id,
        userId: user.id,
        paymentTransactionId: existing.id,
        eventKey: `payment-started:${existing.id}`,
        metadata: { reused: true, amount },
      }).catch((error) => {
        console.error("[sales] Referral payment-start tracking failed", {
          transactionId: existing.id,
          error: error instanceof Error ? error.message : "Unknown referral tracking error",
        });
      });
    }
    console.info("[billing] Reusing pending Manual UPI transaction", {
      packageId: pkg.id,
      subscriptionId: subscription.id,
      transactionId: existing.id,
      userId: user.id,
    });

    if (input.sendWhatsApp !== false && existingPaymentUrl) {
      await safeEnsureManualPaymentWhatsAppSent({
        transactionId: existing.id,
        paymentUrl: existingPaymentUrl,
        packageName: pkg.name,
        amount,
        paymentReference: existingPayload?.paymentReference || existing.merchantTransactionId || existing.id,
        userDisplayName: user.displayName,
        userPhone: user.phone,
      });
    }

    const managedUser = await getManagedUserForSession(user.id);
    return { redirectUrl: buildManualPaymentPath(existing.id), transactionId: existing.id, user: managedUser };
  }

  const paymentReference = existing?.merchantTransactionId ?? id("gx-upi");
  const fallbackSupportWhatsApp = companyKnowledgeBase.supportPhoneE164;
  const fallbackInstructions = "Pay the exact package amount, then send the payment screenshot or UTR on WhatsApp for approval.";
  const fallbackRawRequest = buildManualPaymentRequest({
    amount,
    currency,
    packageId: pkg.id,
    packageName: pkg.name,
    paymentReference,
    subscriptionId: subscription.id,
    supportWhatsApp: fallbackSupportWhatsApp,
    instructions: fallbackInstructions,
    paymentMode: "SUPPORT_ONLY",
  });
  const fallbackRawRequestWithSales = input.salesReferralCode
    ? { ...fallbackRawRequest, salesReferralCode: input.salesReferralCode.trim().toUpperCase() }
    : fallbackRawRequest;
  const reusedPaymentMode: "SUPPORT_ONLY" | "UPI_QR" =
    existingPayload?.paymentMode === "SUPPORT_ONLY" ? "SUPPORT_ONLY" : "UPI_QR";
  const reusedRawRequest = existingPayload
    ? buildManualPaymentRequest({
        amount,
        currency,
        packageId: pkg.id,
        packageName: pkg.name,
        paymentReference: existingPayload.paymentReference || paymentReference,
        subscriptionId: subscription.id,
        supportWhatsApp: existingPayload.supportWhatsApp || fallbackSupportWhatsApp,
        instructions: existingPayload.instructions || fallbackInstructions,
        paymentMode: reusedPaymentMode,
        upiId: existingPayload.upiId,
        payeeName: existingPayload.payeeName,
        upiUri: existingPayload.upiUri,
      })
    : fallbackRawRequestWithSales;

  const transaction = existing
    ? await prisma.paymentTransaction.update({
        where: { id: existing.id },
        data: {
          amount,
          currency,
          rawRequest: reusedRawRequest,
          redirectUrl: buildManualPaymentPath(existing.id),
          status: existing.status === "PENDING" ? "INITIATED" : existing.status,
        },
      })
    : await prisma.paymentTransaction.create({
        data: {
          userId: user.id,
          packageId: pkg.id,
          subscriptionId: subscription.id,
          provider: "UPI_MANUAL",
          transactionType: "ONE_TIME",
          merchantTransactionId: paymentReference,
          merchantOrderId: paymentReference,
          amount,
          currency,
          status: "INITIATED",
          rawRequest: fallbackRawRequestWithSales,
          redirectUrl: null,
        },
      });

  if (transaction.redirectUrl !== buildManualPaymentPath(transaction.id)) {
    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: { redirectUrl: buildManualPaymentPath(transaction.id) },
    });
  }

  try {
    const manualConfig = await getManualUpiAdminConfig();
    console.info("[billing] Starting Manual UPI checkout", {
      packageId: pkg.id,
      subscriptionId: subscription.id,
      userId: user.id,
      configSource: manualConfig.configSource ?? "unknown",
      envFallbackActive: manualConfig.envFallbackActive,
      readyForPayments: manualConfig.readyForPayments,
      reusedTransactionId: existing?.id ?? null,
    });

    const note = `Gigxomi ${pkg.name} ${paymentReference}`.slice(0, 80);
    const resolvedRawRequest = manualConfig.readyForPayments
      ? buildManualPaymentRequest({
          amount,
          currency,
          packageId: pkg.id,
          packageName: pkg.name,
          paymentReference,
          subscriptionId: subscription.id,
          supportWhatsApp: manualConfig.settings.supportWhatsApp,
          instructions: manualConfig.settings.instructions,
          paymentMode: "UPI_QR",
          upiId: manualConfig.settings.upiId,
          payeeName: manualConfig.settings.payeeName,
          upiUri: buildUpiPaymentUri({
            amount,
            currency,
            note,
            payeeName: manualConfig.settings.payeeName,
            transactionReference: paymentReference,
            upiId: manualConfig.settings.upiId,
          }),
        })
      : buildManualPaymentRequest({
          amount,
          currency,
          packageId: pkg.id,
          packageName: pkg.name,
          paymentReference,
          subscriptionId: subscription.id,
          supportWhatsApp: manualConfig.settings.supportWhatsApp || fallbackSupportWhatsApp,
          instructions: manualConfig.settings.instructions || fallbackInstructions,
          paymentMode: "SUPPORT_ONLY",
        });

    const resolvedRawRequestWithSales = input.salesReferralCode
      ? { ...resolvedRawRequest, salesReferralCode: input.salesReferralCode.trim().toUpperCase() }
      : resolvedRawRequest;

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        rawRequest: resolvedRawRequestWithSales,
      },
    });
    if (input.salesReferralCode) {
      await trackSalesReferralEvent({
        code: input.salesReferralCode,
        eventType: "PAYMENT_STARTED",
        packageId: pkg.id,
        userId: user.id,
        paymentTransactionId: transaction.id,
        eventKey: `payment-started:${transaction.id}`,
        metadata: { amount, paymentMode: resolvedRawRequestWithSales.paymentMode },
      }).catch((trackingError) => {
        console.error("[sales] Referral payment-start tracking failed", {
          transactionId: transaction.id,
          error: trackingError instanceof Error ? trackingError.message : "Unknown referral tracking error",
        });
      });
    }

    if (!manualConfig.readyForPayments) {
      console.error("[billing] Manual UPI checkout created in support-only mode", {
        packageId: pkg.id,
        subscriptionId: subscription.id,
        transactionId: transaction.id,
        userId: user.id,
        missingFields: manualConfig.missingFields,
        configSource: manualConfig.configSource ?? "unknown",
        envFallbackActive: manualConfig.envFallbackActive,
      });
    }
  } catch (error) {
    console.error("[billing] Manual UPI config resolution failed after creating fallback transaction", {
      packageId: pkg.id,
      subscriptionId: subscription.id,
      transactionId: transaction.id,
      userId: user.id,
      error: error instanceof Error ? error.message : "Unknown Manual UPI config error",
    });
  }

  const paymentUrl = buildManualPaymentUrl(transaction.id);
  if (input.sendWhatsApp !== false) {
    await safeEnsureManualPaymentWhatsAppSent({
      transactionId: transaction.id,
      paymentUrl,
      packageName: pkg.name,
      amount,
      paymentReference,
      userDisplayName: user.displayName,
      userPhone: user.phone,
    });
  }

  let managedUser: ManagedAuthUser;
  try {
    managedUser = await getManagedUserForSession(user.id);
  } catch (error) {
    console.error("[billing] Managed user refresh failed after creating Manual UPI transaction", {
      transactionId: transaction.id,
      userId: user.id,
      error: error instanceof Error ? error.message : "Unknown managed-user error",
    });
    managedUser = toManagedUser(await getUserOrThrow(user.id));
  }
  return { redirectUrl: buildManualPaymentPath(transaction.id), transactionId: transaction.id, user: managedUser };
}

export async function startPaidPaymentSession(input: {
  userId: string;
  packageId: string;
  salesReferralCode?: string;
  amountOverride?: number;
  billingIntervalOverride?: "MONTHLY" | "YEARLY";
  paymentMode?: "UPI_INTENT" | "UPI_COLLECT";
  upiVpa?: string | null;
  renewalAmountOverride?: number;
  couponDiscountDuration?: "FIRST_CYCLE" | "RECURRING";
}) {
  const pkg = await getPackageOrThrow(input.packageId);
  if (getRegistrationPackageBillingType(pkg) === "RECURRING") {
    return startAutopaySetup(input);
  }
  return startOneTimePayment(input);
}

export async function startAutopaySetup(input: {
  userId: string;
  packageId: string;
  salesReferralCode?: string;
  amountOverride?: number;
  billingIntervalOverride?: "MONTHLY" | "YEARLY";
  paymentMode?: "UPI_INTENT" | "UPI_COLLECT";
  upiVpa?: string | null;
  renewalAmountOverride?: number;
  couponDiscountDuration?: "FIRST_CYCLE" | "RECURRING";
}) {
  await assertPhonePeCapabilityEnabled("autopay");
  const { subscription, pkg, user } = await createOrUpdatePendingSubscription({
    userId: input.userId,
    packageId: input.packageId,
    provider: "PHONEPE",
    amountOverride: input.amountOverride,
    billingIntervalOverride: input.billingIntervalOverride,
    renewalAmountOverride: input.renewalAmountOverride,
    couponDiscountDuration: input.couponDiscountDuration,
    paymentMode: input.paymentMode,
    upiVpa: input.upiVpa,
  });
  // A retry from the same checkout window must not create a second mandate.
  // Reuse a still-live provider redirect when the first setup already reached PhonePe.
  const existingSetup = await prisma.paymentTransaction.findFirst({
    where: {
      userId: user.id,
      packageId: pkg.id,
      subscriptionId: subscription.id,
      transactionType: "SETUP",
      status: { in: ["PENDING", "INITIATED"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  const existingPayload = existingSetup?.rawRequest && typeof existingSetup.rawRequest === "object" && !Array.isArray(existingSetup.rawRequest)
    ? existingSetup.rawRequest as Record<string, unknown>
    : {};
  const existingOrderId = typeof existingPayload.merchantOrderId === "string" ? existingPayload.merchantOrderId : "";
  const existingSubscriptionId = typeof existingPayload.merchantSubscriptionId === "string" ? existingPayload.merchantSubscriptionId : "";
  if (existingSetup?.redirectUrl && existingOrderId && existingSubscriptionId && existingSetup.updatedAt.getTime() > Date.now() - 20 * 60 * 1000) {
    return {
      redirectUrl: existingSetup.redirectUrl,
      transactionId: existingSetup.id,
      merchantOrderId: existingOrderId,
      merchantSubscriptionId: existingSubscriptionId,
      user: await getManagedUserForSession(user.id),
    };
  }
  const amount = toNumber(subscription.amount);
  const merchantOrderId = id("gx-sub-setup");
  const merchantSubscriptionId = subscription.merchantSubscriptionId ?? id("gx-sub");
  const provider = new PhonePeMandateAutopayProvider();
  const result = await provider.setup({
    userId: user.id,
    userName: user.displayName,
    phone: user.phone,
    email: user.email,
    package: { ...pkg, amount, billingInterval: subscription.billingInterval },
    subscriptionId: subscription.id,
    merchantOrderId,
    merchantSubscriptionId,
    amount,
    maxAmount: toNumber(subscription.maxAmount ?? amount),
    currency: pkg.currency ?? "INR",
    paymentMode: input.paymentMode,
    upiVpa: input.upiVpa,
  });
  const transaction = await prisma.$transaction(async (tx) => {
    await tx.paymentTransaction.updateMany({
      where: {
        userId: user.id,
        packageId: pkg.id,
        transactionType: "SETUP",
        status: { in: ["PENDING", "INITIATED"] },
      },
      data: { status: "EXPIRED" },
    });
    await tx.userSubscription.update({
      where: { id: subscription.id },
      data: {
        merchantSubscriptionId,
        setupOrderId: merchantOrderId,
        providerSubscriptionId: result.providerReference ?? null,
        mandateStatus: "SETUP_INITIATED",
      },
    });
    return tx.paymentTransaction.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        subscriptionId: subscription.id,
        provider: "PHONEPE",
        transactionType: "SETUP",
        merchantTransactionId: merchantOrderId,
        merchantOrderId,
        amount,
        currency: pkg.currency ?? "INR",
        status: "INITIATED",
        rawRequest: {
          merchantOrderId,
          merchantSubscriptionId,
          subscriptionId: subscription.id,
          packageId: pkg.id,
          billingInterval: subscription.billingInterval,
          billingCycle: subscription.billingInterval,
          paymentMode: input.paymentMode ?? "UPI_INTENT",
          salesReferralCode: input.salesReferralCode ?? null,
        },
        rawResponse: result.raw as object,
        redirectUrl: result.redirectUrl,
        transactionId: result.providerReference ?? null,
      },
    });
  });

  if (input.salesReferralCode) {
    await trackSalesReferralEvent({
      code: input.salesReferralCode,
      eventType: "PAYMENT_STARTED",
      packageId: pkg.id,
      userId: user.id,
      paymentTransactionId: transaction.id,
      eventKey: `payment-started:${transaction.id}`,
      metadata: { provider: "PHONEPE_AUTOPAY", amount, billingInterval: subscription.billingInterval },
    }).catch(() => undefined);
  }

  return {
    redirectUrl: result.redirectUrl,
    transactionId: transaction.id,
    merchantOrderId,
    merchantSubscriptionId,
    user: await getManagedUserForSession(user.id),
  };
}

export async function startManualUpiRenewalPaymentSession(input: { subscriptionId: string }) {
  const subscription = await prisma.userSubscription.findUnique({
    where: { id: input.subscriptionId },
    include: {
      user: true,
      package: true,
    },
  });

  if (!subscription) {
    throw new Error("Subscription not found.");
  }

  const packageName = subscription.package?.name?.trim() || "Gigxomi subscription";
  const currency = subscription.package?.currency || "INR";
  const amount = toNumber(subscription.amount);
  const existing = await prisma.paymentTransaction.findFirst({
    where: {
      subscriptionId: subscription.id,
      provider: "UPI_MANUAL",
      transactionType: "RENEWAL",
      status: { in: ["PENDING", "INITIATED"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  const existingPayload = readManualPaymentPayload(existing?.rawRequest);

  if (existing && existing.redirectUrl?.trim()) {
    return {
      redirectUrl: existing.redirectUrl,
      transactionId: existing.id,
      paymentReference: existingPayload?.paymentReference || existing.merchantTransactionId || existing.id,
    };
  }

  const paymentReference = existing?.merchantTransactionId ?? id("gx-renew-upi");
  const fallbackSupportWhatsApp = companyKnowledgeBase.supportPhoneE164;
  const fallbackInstructions = "Pay the exact renewal amount, then send the payment screenshot or UTR on WhatsApp for approval.";
  const fallbackRawRequest = buildManualPaymentRequest({
    amount,
    currency,
    packageId: subscription.packageId,
    packageName,
    paymentReference,
    subscriptionId: subscription.id,
    supportWhatsApp: fallbackSupportWhatsApp,
    instructions: fallbackInstructions,
    paymentMode: "SUPPORT_ONLY",
  });

  const transaction = existing
    ? await prisma.paymentTransaction.update({
        where: { id: existing.id },
        data: {
          amount,
          currency,
          rawRequest: existingPayload
            ? buildManualPaymentRequest({
                amount,
                currency,
                packageId: subscription.packageId,
                packageName,
                paymentReference: existingPayload.paymentReference || paymentReference,
                subscriptionId: subscription.id,
                supportWhatsApp: existingPayload.supportWhatsApp || fallbackSupportWhatsApp,
                instructions: existingPayload.instructions || fallbackInstructions,
                paymentMode: existingPayload.paymentMode === "SUPPORT_ONLY" ? "SUPPORT_ONLY" : "UPI_QR",
                upiId: existingPayload.upiId,
                payeeName: existingPayload.payeeName,
                upiUri: existingPayload.upiUri,
              })
            : fallbackRawRequest,
          redirectUrl: buildManualPaymentPath(existing.id),
          status: existing.status === "PENDING" ? "INITIATED" : existing.status,
        },
      })
    : await prisma.paymentTransaction.create({
        data: {
          userId: subscription.userId,
          packageId: subscription.packageId,
          subscriptionId: subscription.id,
          provider: "UPI_MANUAL",
          transactionType: "RENEWAL",
          merchantTransactionId: paymentReference,
          merchantOrderId: paymentReference,
          amount,
          currency,
          status: "INITIATED",
          rawRequest: fallbackRawRequest,
          redirectUrl: buildManualPaymentPath("pending"),
        },
      });

  if (transaction.redirectUrl !== buildManualPaymentPath(transaction.id)) {
    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: { redirectUrl: buildManualPaymentPath(transaction.id) },
    });
  }

  try {
    const manualConfig = await getManualUpiAdminConfig();
    const note = `Gigxomi renewal ${packageName} ${paymentReference}`.slice(0, 80);
    const resolvedRawRequest = manualConfig.readyForPayments
      ? buildManualPaymentRequest({
          amount,
          currency,
          packageId: subscription.packageId,
          packageName,
          paymentReference,
          subscriptionId: subscription.id,
          supportWhatsApp: manualConfig.settings.supportWhatsApp,
          instructions: manualConfig.settings.instructions,
          paymentMode: "UPI_QR",
          upiId: manualConfig.settings.upiId,
          payeeName: manualConfig.settings.payeeName,
          upiUri: buildUpiPaymentUri({
            amount,
            currency,
            note,
            payeeName: manualConfig.settings.payeeName,
            transactionReference: paymentReference,
            upiId: manualConfig.settings.upiId,
          }),
        })
      : buildManualPaymentRequest({
          amount,
          currency,
          packageId: subscription.packageId,
          packageName,
          paymentReference,
          subscriptionId: subscription.id,
          supportWhatsApp: manualConfig.settings.supportWhatsApp || fallbackSupportWhatsApp,
          instructions: manualConfig.settings.instructions || fallbackInstructions,
          paymentMode: "SUPPORT_ONLY",
        });

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        rawRequest: resolvedRawRequest,
        redirectUrl: buildManualPaymentPath(transaction.id),
      },
    });
  } catch (error) {
    console.error("[billing] Manual UPI renewal config resolution failed", {
      subscriptionId: subscription.id,
      transactionId: transaction.id,
      error: error instanceof Error ? error.message : "Unknown Manual UPI renewal config error",
    });
  }

  return {
    redirectUrl: buildManualPaymentPath(transaction.id),
    transactionId: transaction.id,
    paymentReference,
  };
}

export async function startBillingAfterOtp(input: {
  userId: string;
  packageId: string;
  salesReferralCode?: string;
  amountOverride?: number;
  billingCycle?: "MONTHLY" | "YEARLY" | null;
  renewalAmountOverride?: number;
  couponDiscountDuration?: "FIRST_CYCLE" | "RECURRING";
  paymentMode?: "UPI_INTENT" | "UPI_COLLECT";
  upiVpa?: string | null;
}) {
  const pkg = await getPackageOrThrow(input.packageId);
  if (isRegistrationPackageFree(pkg)) {
    const activated = await activateFreeSubscription(input.userId, pkg.id, input.amountOverride);
    return { kind: "activated" as const, ...activated };
  }
  const billingCycle = input.billingCycle ?? (pkg.billingInterval === "YEARLY" ? "YEARLY" : "MONTHLY");
  const packageCycleAmount = billingCycle === "YEARLY" ? toNumber(pkg.priceYearly) : toNumber(pkg.priceMonthly);
  if (input.amountOverride == null && packageCycleAmount <= 0) {
    throw new Error(`This package does not support ${billingCycle.toLowerCase()} billing.`);
  }
  if ((input.amountOverride ?? packageCycleAmount) <= 0) {
    throw new Error("Paid packages require a verified payment; choose Agency Freemium for immediate activation.");
  }
  const payment = await startPaidPaymentSession({
    userId: input.userId,
    packageId: pkg.id,
    salesReferralCode: input.salesReferralCode,
    amountOverride: input.amountOverride ?? packageCycleAmount,
    billingIntervalOverride: billingCycle,
    renewalAmountOverride: input.renewalAmountOverride,
    couponDiscountDuration: input.couponDiscountDuration,
    paymentMode: input.paymentMode,
    upiVpa: input.upiVpa,
  });
  return { kind: "redirect" as const, redirectUrl: payment.redirectUrl, transactionId: payment.transactionId, user: payment.user };
}

export async function getDashboardRedirectForUser(userId: string) {
  const user = await getUserOrThrow(userId);
  return getDashboardPathForIdentity({
    role: user.role,
    packageAudience: user.packageAudience,
    workspaceMode: user.workspaceMode,
  });
}

export async function getManagedUserForSession(userId: string) {
  return toManagedUser(await getUserOrThrow(userId));
}
