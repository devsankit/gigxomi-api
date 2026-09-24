import "server-only";

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const RESERVATION_TTL_MS = 30 * 60 * 1000;

function money(value: unknown) {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
}

export function normalizeCouponCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

export function generateCouponCode(prefix = "GX") {
  const safePrefix = normalizeCouponCode(prefix).slice(0, 8) || "GX";
  return `${safePrefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function calculateDiscount(input: { type: "PERCENTAGE" | "FIXED"; value: number; originalAmount: number }) {
  const raw = input.type === "PERCENTAGE" ? input.originalAmount * (Math.min(100, input.value) / 100) : input.value;
  return Math.min(input.originalAmount, Math.max(0, Math.round(raw * 100) / 100));
}

async function getCouponQuoteWithClient(
  database: Prisma.TransactionClient | typeof prisma,
  input: { code: string; packageId: string; userId?: string | null; originalAmount?: number },
) {
  const code = normalizeCouponCode(input.code);
  if (!code) throw new Error("Enter a valid coupon code.");

  const [coupon, pkg] = await Promise.all([
    database.salesReferralCode.findUnique({ where: { code }, include: { agent: { select: { agentCode: true, userId: true } } } }),
    database.package.findUnique({ where: { id: input.packageId } }),
  ]);
  if (!coupon || !coupon.isActive || !coupon.discountType || coupon.discountValue == null) throw new Error("Coupon is not active.");
  if (!pkg || !pkg.isActive || !pkg.allowRegistration) throw new Error("Package is not available.");

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) throw new Error("Coupon is not active yet.");
  if (coupon.expiresAt && coupon.expiresAt <= now) throw new Error("Coupon has expired.");
  if (coupon.eligiblePackageIds.length && !coupon.eligiblePackageIds.includes(pkg.id)) throw new Error("Coupon is not valid for this package.");

  const activeReservationCutoff = new Date(Date.now() - RESERVATION_TTL_MS);
  const [totalUsed, userUsed] = await Promise.all([
    database.couponRedemption.count({
      where: {
        referralCodeId: coupon.id,
        OR: [{ status: "REDEEMED" }, { status: "RESERVED", createdAt: { gte: activeReservationCutoff } }],
      },
    }),
    input.userId
      ? database.couponRedemption.count({
          where: {
            referralCodeId: coupon.id,
            userId: input.userId,
            OR: [{ status: "REDEEMED" }, { status: "RESERVED", createdAt: { gte: activeReservationCutoff } }],
          },
        })
      : Promise.resolve(0),
  ]);
  if (coupon.maxRedemptions != null && totalUsed >= coupon.maxRedemptions) throw new Error("Coupon redemption limit has been reached.");
  if (input.userId && userUsed >= coupon.perUserLimit) throw new Error("This coupon has already been used by this account.");

  const originalAmount = input.originalAmount == null ? money(pkg.amount) : money(input.originalAmount);
  const discountValue = money(coupon.discountValue);
  const discountAmount = calculateDiscount({ type: coupon.discountType, value: discountValue, originalAmount });
  const finalAmount = Math.max(0, Math.round((originalAmount - discountAmount) * 100) / 100);

  return {
    code,
    couponId: coupon.id,
    agentCode: coupon.agent.agentCode,
    packageId: pkg.id,
    packageName: pkg.name,
    discountType: coupon.discountType,
    discountDuration: coupon.discountDuration,
    discountValue,
    originalAmount,
    discountAmount,
    finalAmount,
  };
}

export function getCouponQuote(input: { code: string; packageId: string; userId?: string | null; originalAmount?: number }) {
  return getCouponQuoteWithClient(prisma, input);
}

export async function reserveCouponWithClient(tx: Prisma.TransactionClient, input: { code: string; packageId: string; userId: string; originalAmount?: number }) {
      const normalizedCode = normalizeCouponCode(input.code);
      // Serialize the global redemption cap, including reservations from other users.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`coupon:${normalizedCode}`}))::text`;
      const existing = await tx.couponRedemption.findFirst({
        where: { userId: input.userId, packageId: input.packageId, status: "RESERVED", createdAt: { gte: new Date(Date.now() - RESERVATION_TTL_MS) }, referralCode: { code: normalizedCode } },
        include: { referralCode: { include: { agent: { select: { agentCode: true } } } }, package: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      const requestedOriginalAmount = input.originalAmount == null ? null : money(input.originalAmount);
      const existingOriginalAmount = existing ? money(existing.originalAmount) : null;
      if (existing && requestedOriginalAmount !== null && existingOriginalAmount !== requestedOriginalAmount) {
        await tx.couponRedemption.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });
      } else if (existing && existing.referralCode.discountType && existing.referralCode.discountValue != null) {
        return {
          redemptionId: existing.id,
          quote: {
            code: normalizedCode,
            couponId: existing.referralCodeId,
            agentCode: existing.referralCode.agent.agentCode,
            packageId: existing.packageId,
            packageName: existing.package.name,
            discountType: existing.referralCode.discountType,
            discountDuration: existing.referralCode.discountDuration,
            discountValue: money(existing.referralCode.discountValue),
            originalAmount: money(existing.originalAmount),
            discountAmount: money(existing.discountAmount),
            finalAmount: money(existing.finalAmount),
          },
        };
      }
      const quote = await getCouponQuoteWithClient(tx, input);
      const redemption = await tx.couponRedemption.create({
        data: {
          referralCodeId: quote.couponId,
          userId: input.userId,
          packageId: input.packageId,
          originalAmount: quote.originalAmount,
          discountAmount: quote.discountAmount,
          finalAmount: quote.finalAmount,
        },
      });
      return { quote, redemptionId: redemption.id };
}

export async function reserveCoupon(input: { code: string; packageId: string; userId: string; originalAmount?: number }) {
  return prisma.$transaction(
    (tx) => reserveCouponWithClient(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function attachCouponReservation(input: { redemptionId: string; paymentTransactionId?: string | null; activated?: boolean }) {
  return prisma.couponRedemption.update({
    where: { id: input.redemptionId },
    data: {
      paymentTransactionId: input.paymentTransactionId ?? undefined,
      status: input.activated ? "REDEEMED" : "RESERVED",
      redeemedAt: input.activated ? new Date() : null,
    },
  });
}

export async function cancelCouponReservation(redemptionId: string) {
  return prisma.couponRedemption.updateMany({
    where: { id: redemptionId, status: "RESERVED" },
    data: { status: "CANCELLED" },
  });
}

export async function markSubscriptionCouponRedeemed(subscriptionId: string) {
  const transactions = await prisma.paymentTransaction.findMany({ where: { subscriptionId }, select: { id: true } });
  if (!transactions.length) return;
  await prisma.couponRedemption.updateMany({
    where: { paymentTransactionId: { in: transactions.map((item) => item.id) }, status: "RESERVED" },
    data: { status: "REDEEMED", redeemedAt: new Date() },
  });
}
