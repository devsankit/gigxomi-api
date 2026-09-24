import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { PhonePeMandateAutopayProvider } from "@/lib/billing/phonepe-providers";

function orderId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function nextBillingDate(interval: string, from = new Date()) {
  const date = new Date(from);
  if (interval === "YEARLY") date.setFullYear(date.getFullYear() + 1);
  else if (interval === "QUARTERLY") date.setMonth(date.getMonth() + 3);
  else date.setMonth(date.getMonth() + 1);
  return date;
}

export async function notifyRedemption(subscriptionId: string) {
  const subscription = await prisma.userSubscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription?.merchantSubscriptionId) throw new Error("Subscription mandate is not ready.");
  const provider = new PhonePeMandateAutopayProvider();
  const merchantOrderId = orderId("gx-renew-notify");
  const result = await provider.notifyRedemption({
    merchantSubscriptionId: subscription.merchantSubscriptionId,
    merchantOrderId,
    amount: Number(subscription.renewalAmount ?? subscription.amount),
    currency: "INR",
    subscriptionId: subscription.id,
  });
  await prisma.recurringBillingEvent.create({
    data: {
      subscriptionId: subscription.id,
      eventType: "NOTIFY",
      providerReference: merchantOrderId,
      payload: result.raw as object,
      state: result.state,
      occurredAt: new Date(),
    },
  });
  return { merchantOrderId, result };
}

export async function executeRedemption(input: { subscriptionId: string; merchantOrderId?: string }) {
  const subscription = await prisma.userSubscription.findUnique({ where: { id: input.subscriptionId }, include: { package: { select: { gracePeriodDays: true } } } });
  if (!subscription?.merchantSubscriptionId) throw new Error("Subscription mandate is not ready.");
  const provider = new PhonePeMandateAutopayProvider();
  const merchantOrderId = input.merchantOrderId || orderId("gx-renew-execute");
  const result = await provider.executeRedemption({
    merchantSubscriptionId: subscription.merchantSubscriptionId,
    merchantOrderId,
    amount: Number(subscription.renewalAmount ?? subscription.amount),
    currency: "INR",
    subscriptionId: subscription.id,
  });
  await prisma.recurringBillingEvent.create({
    data: {
      subscriptionId: subscription.id,
      eventType: "EXECUTE",
      providerReference: merchantOrderId,
      payload: result.raw as object,
      state: result.state,
      occurredAt: new Date(),
    },
  });

  if (result.ok) {
    await prisma.userSubscription.update({
      where: { id: subscription.id },
      data: {
        status: "ACTIVE",
        paymentStatus: "PAID",
        renewsAt: nextBillingDate(subscription.billingInterval),
        nextBillingDate: nextBillingDate(subscription.billingInterval),
      },
    });
  } else {
    const graceDays = Math.max(0, subscription.package?.gracePeriodDays ?? 0);
    await prisma.userSubscription.update({
      where: { id: subscription.id },
      data: { status: "PAST_DUE", paymentStatus: "FAILED", graceEndsAt: graceDays ? new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000) : new Date() },
    });
  }
  return { merchantOrderId, result };
}

export async function processDueRenewals(limit = 25) {
  const subscriptions = await prisma.userSubscription.findMany({
    where: {
      billingType: "RECURRING",
      autoRenew: true,
      status: { in: ["ACTIVE", "TRIALING"] },
      nextBillingDate: { lte: new Date() },
      merchantSubscriptionId: { not: null },
    },
    take: limit,
    orderBy: { nextBillingDate: "asc" },
  });

  const results = [];
  for (const subscription of subscriptions) {
    try {
      const notified = await notifyRedemption(subscription.id);
      results.push({ subscriptionId: subscription.id, ok: true, step: "notify", merchantOrderId: notified.merchantOrderId });
    } catch (error) {
      await prisma.userSubscription.update({
        where: { id: subscription.id },
        data: { status: "PAST_DUE", paymentStatus: "FAILED" },
      });
      results.push({ subscriptionId: subscription.id, ok: false, error: error instanceof Error ? error.message : "Unknown renewal error" });
    }
  }

  return { processed: results.length, results };
}
