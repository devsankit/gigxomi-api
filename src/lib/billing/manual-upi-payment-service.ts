import "server-only";

import { prisma } from "@/lib/prisma";
import { activateSubscription } from "@/lib/billing/subscription-service";
import { processSalesPaymentSuccess } from "@/lib/gigxomi/sales-store";

export async function listPendingManualUpiPayments() {
  const transactions = await prisma.paymentTransaction.findMany({
    where: {
      provider: "UPI_MANUAL",
      status: { in: ["PENDING", "INITIATED"] },
    },
    include: {
      package: true,
      subscription: true,
      user: true,
      logs: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return transactions.map((transaction) => ({
    id: transaction.id,
    reference: transaction.merchantTransactionId ?? transaction.id,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    status: transaction.status,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
    user: {
      id: transaction.user.id,
      displayName: transaction.user.displayName,
      phone: transaction.user.phone,
      email: transaction.user.email,
      packageStatus: transaction.user.packageStatus,
    },
    package: {
      id: transaction.package.id,
      name: transaction.package.name,
      packageType: transaction.package.packageType,
    },
    subscription: transaction.subscription
      ? {
          id: transaction.subscription.id,
          status: transaction.subscription.status,
          paymentStatus: transaction.subscription.paymentStatus,
        }
      : null,
    lastLog: transaction.logs[0]
      ? {
          eventType: transaction.logs[0].eventType,
          status: transaction.logs[0].status,
          createdAt: transaction.logs[0].createdAt.toISOString(),
        }
      : null,
  }));
}

export async function approveManualUpiPayment(input: { transactionId: string; reviewedByUserId: string }) {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id: input.transactionId },
  });
  if (!transaction || transaction.provider !== "UPI_MANUAL") {
    return { ok: false as const, error: "Manual UPI payment was not found." };
  }
  if (!transaction.subscriptionId) {
    return { ok: false as const, error: "Payment is not linked to a subscription." };
  }

  await prisma.paymentTransaction.update({
    where: { id: transaction.id },
    data: {
      status: "SUCCESS",
      paidAt: new Date(),
      rawResponse: {
        approvedByUserId: input.reviewedByUserId,
        approvedAt: new Date().toISOString(),
        method: "manual_upi_admin_approval",
      },
    },
  });
  await prisma.paymentLog.create({
    data: {
      transactionId: transaction.id,
      eventType: "manual_upi_approved",
      status: "SUCCESS",
      payload: {
        reviewedByUserId: input.reviewedByUserId,
      },
    },
  });
  await activateSubscription({
    subscriptionId: transaction.subscriptionId,
    verifiedTransactionId: transaction.id,
    providerState: "MANUAL_UPI_APPROVED",
    providerPayload: {
      transactionId: transaction.id,
      reviewedByUserId: input.reviewedByUserId,
    },
  });
  await processSalesPaymentSuccess(transaction.id).catch((error) => {
    console.error("[sales] Manual UPI sales commission processing failed", {
      transactionId: transaction.id,
      error: error instanceof Error ? error.message : "Unknown sales processing error",
    });
  });

  return { ok: true as const };
}

export async function rejectManualUpiPayment(input: { transactionId: string; reviewedByUserId: string; reason?: string }) {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id: input.transactionId },
  });
  if (!transaction || transaction.provider !== "UPI_MANUAL") {
    return { ok: false as const, error: "Manual UPI payment was not found." };
  }

  await prisma.paymentTransaction.update({
    where: { id: transaction.id },
    data: {
      status: "PENDING",
      rawResponse: {
        rejectedByUserId: input.reviewedByUserId,
        rejectedAt: new Date().toISOString(),
        reason: input.reason ?? "Manual payment proof was rejected.",
      },
    },
  });
  await prisma.paymentLog.create({
    data: {
      transactionId: transaction.id,
      eventType: "manual_upi_rejected",
      status: "PENDING",
      payload: {
        reviewedByUserId: input.reviewedByUserId,
        reason: input.reason ?? null,
      },
    },
  });

  return { ok: true as const };
}
