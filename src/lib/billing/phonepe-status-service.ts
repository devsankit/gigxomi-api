import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { PhonePeMandateAutopayProvider, PhonePeStandardCheckoutProvider } from "@/lib/billing/phonepe-providers";
import { activateSubscription } from "@/lib/billing/subscription-service";
import { sendPaymentReceiptWhatsApp } from "@/lib/billing/invoice-service";
import { processSalesPaymentSuccess } from "@/lib/gigxomi/sales-store";
import { reconcileGatewayCheckout } from "@/lib/billing/gateway-checkout-service";

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, keys: string[]) {
  let current: unknown = value;
  for (const key of keys) current = asRecord(current)[key];
  return typeof current === "string" ? current : "";
}

function isPaymentSuccessState(state: string) {
  return ["COMPLETED", "SUCCESS", "PAYMENT_SUCCESS"].includes(state.toUpperCase());
}

function isSubscriptionSuccessState(state: string) {
  return ["ACTIVE", "AUTHORIZATION_SUCCESSFUL", "EXECUTED"].includes(state.toUpperCase());
}

function isFailureState(state: string) {
  return ["FAILED", "CANCELLED", "EXPIRED", "REVOKED"].includes(state.toUpperCase());
}

function webhookDedupeKey(input: { subscriptionId: string; event: string; providerReference: string; state: string }) {
  return createHash("sha256")
    .update([input.subscriptionId, input.event, input.providerReference, input.state.toUpperCase()].join("|"))
    .digest("hex");
}

async function markTransactionFromState(transactionId: string, state: string, raw: unknown) {
  const status = isPaymentSuccessState(state) ? "SUCCESS" : isFailureState(state) ? "FAILED" : "INITIATED";
  const existing = await prisma.paymentTransaction.findUnique({
    where: { id: transactionId },
    select: { paidAt: true },
  });
  return prisma.paymentTransaction.update({
    where: { id: transactionId },
    data: {
      status,
      rawResponse: raw as object,
      paidAt: status === "SUCCESS" ? existing?.paidAt ?? new Date() : undefined,
    },
  });
}

type PaymentTransactionRecord = NonNullable<Awaited<ReturnType<typeof prisma.paymentTransaction.findFirst>>>;

function readNumber(value: unknown, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) current = asRecord(current)[key];
    const parsed = Number(current);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function assertPhonePePaymentProof(transaction: PaymentTransactionRecord, raw: unknown) {
  if (!transaction.subscriptionId) throw new Error("PhonePe payment is not linked to a subscription.");
  const subscription = await prisma.userSubscription.findUnique({ where: { id: transaction.subscriptionId } });
  if (!subscription) throw new Error("PhonePe payment subscription was not found.");
  if (
    subscription.userId !== transaction.userId ||
    subscription.packageId !== transaction.packageId ||
    Number(subscription.amount) !== Number(transaction.amount)
  ) {
    throw new Error("PhonePe payment does not match its subscription.");
  }
  if (subscription.billingType === "RECURRING" && !["MONTHLY", "YEARLY"].includes(subscription.billingInterval)) {
    throw new Error("PhonePe recurring payment has an invalid billing cycle.");
  }
  const rawRequest =
    transaction.rawRequest && typeof transaction.rawRequest === "object" && !Array.isArray(transaction.rawRequest)
      ? (transaction.rawRequest as Record<string, unknown>)
      : {};
  const requestedBillingCycle = rawRequest.billingCycle ?? rawRequest.billingInterval;
  if (requestedBillingCycle !== subscription.billingInterval) {
    throw new Error("PhonePe payment billing cycle verification failed.");
  }

  const providerAmount = readNumber(raw, [["amount"], ["payload", "amount"], ["data", "amount"], ["paymentDetails", "0", "amount"]]);
  if (providerAmount === null || Math.round(providerAmount) !== Math.round(Number(transaction.amount) * 100)) {
    throw new Error("PhonePe payment amount verification failed.");
  }
  const providerOrderId =
    readString(raw, ["merchantOrderId"]) ||
    readString(raw, ["orderId"]) ||
    readString(raw, ["payload", "merchantOrderId"]) ||
    readString(raw, ["data", "merchantOrderId"]);
  const expectedOrderId = transaction.merchantOrderId || transaction.merchantTransactionId || "";
  if (providerOrderId && expectedOrderId && providerOrderId !== expectedOrderId) {
    throw new Error("PhonePe payment order verification failed.");
  }
  const providerSubscriptionId = readString(raw, ["metaInfo", "udf2"]) || readString(raw, ["payload", "metaInfo", "udf2"]);
  const providerPackageId = readString(raw, ["metaInfo", "udf3"]) || readString(raw, ["payload", "metaInfo", "udf3"]);
  const providerBillingCycle = readString(raw, ["metaInfo", "udf5"]) || readString(raw, ["payload", "metaInfo", "udf5"]);
  if (providerSubscriptionId && providerSubscriptionId !== subscription.id) throw new Error("PhonePe subscription verification failed.");
  if (providerPackageId && providerPackageId !== transaction.packageId) throw new Error("PhonePe package verification failed.");
  if (providerBillingCycle && providerBillingCycle !== subscription.billingInterval) throw new Error("PhonePe billing cycle verification failed.");
  return subscription;
}

async function sendReceiptWithoutBlockingPayment(transactionId: string) {
  try {
    await sendPaymentReceiptWhatsApp(transactionId);
  } catch (error) {
    console.error("[billing] PhonePe receipt WhatsApp send failed", {
      transactionId,
      error: error instanceof Error ? error.message : "Unknown receipt send error",
    });
  }
}

async function getVerifiedPaymentResult(transaction: Awaited<ReturnType<typeof prisma.paymentTransaction.findFirst>>) {
  if (!transaction) {
    return { transaction: null, user: null, subscription: null, pkg: null };
  }

  const [user, subscription, pkg] = await Promise.all([
    prisma.appAuthUser.findUnique({ where: { id: transaction.userId } }),
    transaction.subscriptionId ? prisma.userSubscription.findUnique({ where: { id: transaction.subscriptionId } }) : Promise.resolve(null),
    prisma.package.findUnique({ where: { id: transaction.packageId } }),
  ]);

  return { transaction, user, subscription, pkg };
}

export async function verifyOneTimePayment(merchantTransactionId: string) {
  const transaction = await prisma.paymentTransaction.findFirst({
    where: { OR: [{ merchantTransactionId }, { merchantOrderId: merchantTransactionId }] },
  });
  if (!transaction) throw new Error("Payment transaction not found.");
  if (transaction.status === "SUCCESS") {
    const subscription = await assertPhonePePaymentProof(transaction, transaction.rawResponse);
    if (!["ACTIVE", "TRIALING"].includes(subscription.status) || subscription.paymentStatus !== "PAID") {
      await activateSubscription({
        subscriptionId: subscription.id,
        verifiedTransactionId: transaction.id,
        providerState: "COMPLETED",
        providerPayload: transaction.rawResponse,
      });
    }
    await processSalesPaymentSuccess(transaction.id).catch((error) => {
      console.error("[sales] PhonePe status sales commission processing failed", {
        transactionId: transaction.id,
        error: error instanceof Error ? error.message : "Unknown sales processing error",
      });
    });
    await sendReceiptWithoutBlockingPayment(transaction.id);
    return getVerifiedPaymentResult(transaction);
  }
  const provider = new PhonePeStandardCheckoutProvider();
  const status = await provider.getStatus(merchantTransactionId);
  if (isPaymentSuccessState(status.state)) await assertPhonePePaymentProof(transaction, status.raw);
  const updated = await markTransactionFromState(transaction.id, status.state, status.raw);
  if (updated.status === "SUCCESS" && transaction.subscriptionId) {
    const result = await activateSubscription({ subscriptionId: transaction.subscriptionId, verifiedTransactionId: updated.id, providerState: status.state, providerPayload: status.raw });
    await processSalesPaymentSuccess(updated.id).catch((error) => {
      console.error("[sales] PhonePe status sales commission processing failed", {
        transactionId: updated.id,
        error: error instanceof Error ? error.message : "Unknown sales processing error",
      });
    });
    await sendReceiptWithoutBlockingPayment(updated.id);
    return result;
  }
  return { transaction: updated, user: null, subscription: null, pkg: null };
}

export async function verifyAutopaySetup(merchantOrderId: string) {
  const transaction = await prisma.paymentTransaction.findFirst({
    where: { OR: [{ merchantOrderId }, { merchantTransactionId: merchantOrderId }] },
  });
  if (!transaction?.subscriptionId) throw new Error("Autopay setup transaction not found.");
  const provider = new PhonePeMandateAutopayProvider();
  const status = await provider.getSetupStatus(merchantOrderId);
  await markTransactionFromState(transaction.id, status.state, status.raw);
  const subscription = await prisma.userSubscription.update({
    where: { id: transaction.subscriptionId },
    data: {
      mandateStatus: status.state,
      subscriptionState: status.state,
      providerSubscriptionId: status.providerReference ?? undefined,
    },
  });
  const result = await getVerifiedPaymentResult(transaction);
  return { ...result, subscription };
}

export async function updateSubscriptionStatusFromProvider(merchantSubscriptionId: string) {
  const subscription = await prisma.userSubscription.findUnique({ where: { merchantSubscriptionId } });
  if (!subscription) throw new Error("Subscription not found.");
  const provider = new PhonePeMandateAutopayProvider();
  const status = await provider.getSubscriptionStatus(merchantSubscriptionId);
  const nextStatus = isFailureState(status.state) ? "PAST_DUE" : subscription.status;
  const updated = await prisma.userSubscription.update({
    where: { id: subscription.id },
    data: {
      status: nextStatus,
      subscriptionState: status.state,
      providerSubscriptionId: status.providerReference ?? subscription.providerSubscriptionId,
    },
  });
  await prisma.recurringBillingEvent.create({
    data: {
      subscriptionId: subscription.id,
      eventType: "STATUS",
      providerReference: status.providerReference ?? merchantSubscriptionId,
      payload: status.raw as object,
      state: status.state,
      occurredAt: new Date(),
    },
  });
  return updated;
}

export async function processPhonePePaymentWebhook(payload: unknown) {
  const merchantTransactionId =
    readString(payload, ["merchantTransactionId"]) ||
    readString(payload, ["payload", "merchantTransactionId"]) ||
    readString(payload, ["data", "merchantTransactionId"]) ||
    readString(payload, ["merchantOrderId"]) ||
    readString(payload, ["payload", "merchantOrderId"]);
  const event = readString(payload, ["event"]) || readString(payload, ["type"]) || "phonepe.payment.webhook";
  const state = readString(payload, ["payload", "state"]) || readString(payload, ["state"]) || readString(payload, ["code"]) || "UNKNOWN";
  const transaction = merchantTransactionId
    ? await prisma.paymentTransaction.findFirst({ where: { OR: [{ merchantTransactionId }, { merchantOrderId: merchantTransactionId }] } })
    : null;

  await prisma.paymentLog.create({
    data: {
      transactionId: transaction?.id ?? null,
      eventType: event,
      payload: payload as object,
      status: state,
    },
  });

  if (!transaction || !merchantTransactionId) {
    return { ok: true, ignored: true };
  }
  if (asRecord(transaction.rawRequest).checkoutVersion === 2) {
    const verified = await reconcileGatewayCheckout(merchantTransactionId);
    if (verified?.status === "SUCCESS") {
      await processSalesPaymentSuccess(transaction.id).catch(() => undefined);
      await sendReceiptWithoutBlockingPayment(transaction.id);
    }
    return { ok: true, status: verified?.status ?? "PENDING" };
  }
  if (transaction.status === "SUCCESS") {
    return { ok: true, duplicate: true };
  }
  if (isPaymentSuccessState(state)) {
    await assertPhonePePaymentProof(transaction, payload);
    const updated = await markTransactionFromState(transaction.id, state, payload);
    await processSalesPaymentSuccess(transaction.id).catch((error) => {
      console.error("[sales] PhonePe webhook sales commission processing failed", {
        transactionId: transaction.id,
        error: error instanceof Error ? error.message : "Unknown sales processing error",
      });
    });
    if (transaction.subscriptionId) {
      await activateSubscription({ subscriptionId: transaction.subscriptionId, verifiedTransactionId: updated.id, providerState: state, providerPayload: payload });
      await sendReceiptWithoutBlockingPayment(updated.id);
    }
  } else if (isFailureState(state)) {
    await markTransactionFromState(transaction.id, state, payload);
  }
  return { ok: true };
}

export async function processPhonePeSubscriptionWebhook(payload: unknown) {
  const merchantSubscriptionId =
    readString(payload, ["merchantSubscriptionId"]) ||
    readString(payload, ["payload", "merchantSubscriptionId"]) ||
    readString(payload, ["data", "merchantSubscriptionId"]);
  const merchantOrderId =
    readString(payload, ["merchantOrderId"]) ||
    readString(payload, ["payload", "merchantOrderId"]) ||
    readString(payload, ["data", "merchantOrderId"]);
  const event = readString(payload, ["event"]) || readString(payload, ["type"]) || "phonepe.subscription.webhook";
  if (merchantOrderId) {
    const verified = await reconcileGatewayCheckout(merchantOrderId);
    if (verified) return { ok: true, status: verified.status };
  }
  const state = readString(payload, ["payload", "state"]) || readString(payload, ["state"]) || "UNKNOWN";
  const subscription = merchantSubscriptionId
    ? await prisma.userSubscription.findUnique({ where: { merchantSubscriptionId } })
    : merchantOrderId
      ? await prisma.userSubscription.findFirst({ where: { setupOrderId: merchantOrderId } })
      : null;

  if (!subscription) {
    return { ok: true, ignored: true };
  }

  const providerReference = merchantOrderId || merchantSubscriptionId || event;
  const dedupeKey = webhookDedupeKey({ subscriptionId: subscription.id, event, providerReference, state });
  try {
    await prisma.recurringBillingEvent.create({
      data: {
        dedupeKey,
        subscriptionId: subscription.id,
        eventType: "WEBHOOK",
        providerReference,
        payload: payload as object,
        state,
        occurredAt: new Date(),
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return { ok: true, duplicate: true };
    }
    throw error;
  }

  if (isSubscriptionSuccessState(state)) {
    await prisma.userSubscription.update({
      where: { id: subscription.id },
      data: { subscriptionState: state },
    });
  } else if (isFailureState(state)) {
    await prisma.userSubscription.update({
      where: { id: subscription.id },
      data: {
        status: state.toUpperCase() === "REVOKED" ? "REVOKED" : "PAST_DUE",
        subscriptionState: state,
        revokedAt: state.toUpperCase() === "REVOKED" ? new Date() : undefined,
      },
    });
  }
  return { ok: true };
}
