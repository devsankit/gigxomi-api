import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { BillingCheckoutIntent } from "@/lib/billing/checkout-intent";
import { assertPhonePeCapabilityEnabled, recordPhonePeProviderDiagnostic } from "@/lib/billing/phonepe-admin-config-service";
import { PhonePeRequestError } from "@/lib/billing/phonepe-client";
import { PhonePeMandateAutopayProvider, PhonePeStandardCheckoutProvider } from "@/lib/billing/phonepe-providers";
import { classifyPhonePeCheckoutError } from "@/lib/billing/phonepe-checkout-errors";
import { assertGatewayProof, checkoutTerminal, paidPeriodEnd, record, type GatewayPaymentKind } from "@/lib/billing/gateway-checkout-policy";
import { findRegistrationPackage } from "@/lib/gigxomi/public-growth-store";
import { ensurePersistedRegistrationPackage } from "@/lib/billing/package-service";
import { reserveCouponWithClient } from "@/lib/connected-platform/coupons";

const CHECKOUT_LIFETIME_MS = 20 * 60 * 1000;

/** Persist an immutable order before contacting PhonePe. No customer access is changed here. */
export async function startGatewayCheckout(input: {
  intent: BillingCheckoutIntent; kind: GatewayPaymentKind; requestId: string;
  paymentMode: "UPI_INTENT" | "UPI_COLLECT"; upiVpa?: string; couponCode?: string;
}) {
  await assertPhonePeCapabilityEnabled(input.kind === "ONE_TIME" ? "one_time" : "autopay");
  await assertPhonePeCapabilityEnabled("webhook");
  const found = await findRegistrationPackage(input.intent.packageId);
  if (!found?.isActive || found.allowRegistration === false || found.audience !== "AGENCY" || found.isFree) throw new Error("Package changed.");
  const pkg = await ensurePersistedRegistrationPackage(found);
  const baseAmount = Number(input.intent.billingCycle === "YEARLY" ? pkg.priceYearly : pkg.priceMonthly);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) throw new Error("Package changed.");
  // Serialize reservation and creation across server workers, without holding a DB lock during HTTP calls.
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${input.intent.userId}`}))::text`;
    const user = await tx.appAuthUser.findUnique({ where: { id: input.intent.userId } });
    if (!user) throw new Error("User not found.");
    if (user.packageAudience !== "AGENCY" && user.workspaceMode !== "AGENCY" && user.role !== "ADMIN") throw new Error("Agency account required.");
    const active = await tx.userSubscription.findFirst({ where: { userId: user.id, packageId: pkg.id, status: "ACTIVE", paymentStatus: "PAID", expiresAt: { gt: new Date() } } });
    if (active) throw new Error("This package is already active.");
    const existing = await tx.paymentTransaction.findFirst({
      where: { userId: user.id, provider: "PHONEPE", status: { in: ["PENDING", "INITIATED"] }, transactionType: { in: ["ONE_TIME", "SETUP"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const snapshot = record(existing.rawRequest);
      // Ambiguous/expired orders must be checked before creating a replacement. Never blindly retry a POST.
      if (existing.createdAt.getTime() + CHECKOUT_LIFETIME_MS <= Date.now() || !existing.redirectUrl) throw new Error("Payment confirmation is pending.");
      if (existing.packageId !== pkg.id || snapshot.billingCycle !== input.intent.billingCycle || snapshot.paymentKind !== input.kind || snapshot.couponCode !== (input.couponCode?.trim().toUpperCase() || "")) {
        throw new Error("Payment confirmation is pending.");
      }
      return { transaction: existing, user, reused: true };
    }
    // The coupon, subscription and order commit together before any gateway request.
    const reservation = input.couponCode ? await reserveCouponWithClient(tx, { code: input.couponCode, packageId: pkg.id, userId: user.id, originalAmount: baseAmount }) : null;
    const amount = reservation?.quote.finalAmount ?? baseAmount;
    if (amount <= 0) throw new Error("Coupon must leave a positive paid amount. Choose Freemium for free access.");
    const recurring = input.kind === "AUTOPAY";
    const merchantOrderId = `gx-${randomUUID().replaceAll("-", "")}`;
    const merchantSubscriptionId = recurring ? `gx-sub-${randomUUID().replaceAll("-", "")}` : null;
    const renewalAmount = reservation?.quote.discountDuration === "RECURRING" ? amount : baseAmount;
    const subscription = await tx.userSubscription.create({ data: {
      userId: user.id, packageId: pkg.id, packageType: "AGENCY", provider: "PHONEPE",
      billingType: recurring ? "RECURRING" : "ONE_TIME_PAID", billingInterval: input.intent.billingCycle,
      status: "PENDING", paymentStatus: "PENDING", autoRenew: recurring, autoDebit: recurring,
      amount, renewalAmount: recurring ? renewalAmount : null, maxAmount: recurring ? Math.max(amount, renewalAmount) : null,
      merchantSubscriptionId, setupOrderId: recurring ? merchantOrderId : null,
      couponDiscountDuration: reservation?.quote.discountDuration,
    } });
    const transaction = await tx.paymentTransaction.create({ data: {
      userId: user.id, packageId: pkg.id, subscriptionId: subscription.id, provider: "PHONEPE",
      transactionType: recurring ? "SETUP" : "ONE_TIME", merchantTransactionId: merchantOrderId, merchantOrderId,
      amount, currency: pkg.currency ?? "INR", status: "INITIATED",
      rawRequest: { checkoutVersion: 2, paymentKind: input.kind, merchantSubscriptionId, billingCycle: input.intent.billingCycle,
        returnTarget: input.intent.returnTarget, paymentMode: input.paymentMode, requestId: input.requestId,
        couponCode: reservation?.quote.code ?? "", renewalAmount, expiresAt: Date.now() + CHECKOUT_LIFETIME_MS },
    } });
    if (reservation) await tx.couponRedemption.update({ where: { id: reservation.redemptionId }, data: { paymentTransactionId: transaction.id } });
    return { transaction, user, reused: false };
  }, { timeout: 15_000 });
  if (prepared.reused) return prepared.transaction;
  const transaction = prepared.transaction;
  const snapshot = record(transaction.rawRequest);
  const providerInput = {
    userId: prepared.user.id, userName: prepared.user.displayName, phone: prepared.user.phone,
    email: prepared.user.email, package: { ...pkg, billingInterval: input.intent.billingCycle },
    subscriptionId: transaction.subscriptionId!, merchantOrderId: transaction.merchantOrderId!,
    merchantTransactionId: transaction.merchantOrderId!, amount: Number(transaction.amount), currency: transaction.currency,
  };
  try {
    const response = input.kind === "ONE_TIME"
      ? await new PhonePeStandardCheckoutProvider().initiate(providerInput)
      : await new PhonePeMandateAutopayProvider().setup({ ...providerInput,
          merchantSubscriptionId: String(snapshot.merchantSubscriptionId), maxAmount: Math.max(Number(transaction.amount), Number(snapshot.renewalAmount)),
          paymentMode: input.paymentMode, upiVpa: input.upiVpa });
    // A webhook may win the race; never overwrite its SUCCESS/FAILED state.
    const updated = await prisma.paymentTransaction.update({ where: { id: transaction.id }, data: {
      redirectUrl: response.redirectUrl, transactionId: response.providerReference,
      rawRequest: { ...snapshot, providerOrderId: typeof record(response.raw).orderId === "string" ? String(record(response.raw).orderId) : null },
    } });
    await recordPhonePeProviderDiagnostic({ status: `${input.kind}_INITIATED`, requestId: input.requestId }).catch(() => undefined);
    return updated;
  } catch (error) {
    const code = classifyPhonePeCheckoutError(error);
    // Timeout/5xx can mean the order exists at PhonePe. Preserve it for reconciliation, never create another charge.
    const rejected = error instanceof PhonePeRequestError && [400, 401, 403, 422].includes(error.status);
    if (rejected) await prisma.$transaction(async (tx) => {
      const changed = await tx.paymentTransaction.updateMany({ where: { id: transaction.id, status: { in: ["INITIATED", "PENDING"] } }, data: { status: "FAILED" } });
      if (changed.count) {
        await tx.userSubscription.updateMany({ where: { id: transaction.subscriptionId!, status: "PENDING" }, data: { status: "EXPIRED", paymentStatus: "FAILED" } });
        await tx.couponRedemption.updateMany({ where: { paymentTransactionId: transaction.id, status: "RESERVED" }, data: { status: "CANCELLED" } });
      }
    });
    await recordPhonePeProviderDiagnostic({ status: code.toUpperCase(), requestId: input.requestId }).catch(() => undefined);
    throw error;
  }
}

/** Both authenticated polling and authenticated webhooks use the same server-to-server proof. */
export async function reconcileGatewayCheckout(merchantOrderId: string) {
  const payment = await prisma.paymentTransaction.findUnique({ where: { merchantOrderId } });
  if (!payment || record(payment.rawRequest).checkoutVersion !== 2) return null;
  if (payment.status === "SUCCESS" || checkoutTerminal(payment.status)) return { status: payment.status };
  const provider = payment.transactionType === "SETUP" ? new PhonePeMandateAutopayProvider() : new PhonePeStandardCheckoutProvider();
  const response = provider instanceof PhonePeMandateAutopayProvider ? await provider.getSetupStatus(merchantOrderId) : await provider.getStatus(merchantOrderId);
  const snapshot = record(payment.rawRequest);
  if (response.state === "COMPLETED") assertGatewayProof({ raw: response.raw, merchantOrderId,
    providerOrderId: typeof snapshot.providerOrderId === "string" ? snapshot.providerOrderId : null,
    amount: Number(payment.amount), userId: payment.userId, packageId: payment.packageId, subscriptionId: payment.subscriptionId!, cycle: String(snapshot.billingCycle) });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${payment.userId}`}))::text`;
    const current = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
    const subscription = await tx.userSubscription.findUniqueOrThrow({ where: { id: payment.subscriptionId! }, include: { package: true } });
    if (current.status === "SUCCESS" || checkoutTerminal(current.status) || checkoutTerminal(subscription.status)) return { status: current.status };
    if (["FAILED", "CANCELLED", "EXPIRED"].includes(response.state)) {
      await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: "FAILED", rawResponse: response.raw as object } });
      await tx.userSubscription.update({ where: { id: subscription.id }, data: { status: "EXPIRED", paymentStatus: "FAILED" } });
      await tx.couponRedemption.updateMany({ where: { paymentTransactionId: payment.id, status: "RESERVED" }, data: { status: "CANCELLED" } });
      return { status: "FAILED" };
    }
    if (response.state !== "COMPLETED") return { status: "PENDING" };
    if (subscription.userId !== payment.userId || subscription.packageId !== payment.packageId || Number(subscription.amount) !== Number(payment.amount) || subscription.billingInterval !== snapshot.billingCycle) throw new Error("PhonePe subscription verification failed.");
    const startsAt = new Date();
    const end = paidPeriodEnd(startsAt, subscription.billingInterval === "YEARLY" ? "YEARLY" : "MONTHLY");
    const recurring = snapshot.paymentKind === "AUTOPAY";
    await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: "SUCCESS", paidAt: startsAt, rawResponse: response.raw as object } });
    await tx.userSubscription.update({ where: { id: subscription.id }, data: { status: "ACTIVE", paymentStatus: "PAID", startsAt,
      expiresAt: end, renewsAt: recurring ? end : null, nextBillingDate: recurring ? end : null,
      mandateStatus: recurring ? "ACTIVE" : null, subscriptionState: "COMPLETED" } });
    const user = await tx.appAuthUser.findUniqueOrThrow({ where: { id: payment.userId } });
    await tx.appAuthUser.update({ where: { id: payment.userId }, data: {
      packageId: payment.packageId, packageName: subscription.package.name, packageAudience: "AGENCY",
      packageStatus: "ACTIVE", packageExpiresAt: end,
      tenantId: user.tenantId && user.tenantId !== "tenant-gigxomi" ? user.tenantId : `tenant-agency-${randomUUID()}`,
    } });
    await tx.subscriptionStatusHistory.create({ data: { subscriptionId: subscription.id, fromStatus: subscription.status, toStatus: "ACTIVE", reason: "phonepe_server_verified_payment" } });
    await tx.couponRedemption.updateMany({ where: { paymentTransactionId: payment.id, status: "RESERVED" }, data: { status: "REDEEMED", redeemedAt: startsAt } });
    await tx.connectedOnboardingState.updateMany({ where: { userId: payment.userId, stage: "PAYMENT" }, data: { stage: "PROFILE", activatedAt: startsAt } });
    return { status: "SUCCESS" };
  });
}
