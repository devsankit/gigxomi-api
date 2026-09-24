import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { SessionUser } from "@/lib/auth/types";
import { PhonePeHttpClient, readPhonePeRedirectUrl, readPhonePeReference, readPhonePeState } from "@/lib/billing/phonepe-client";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { prisma } from "@/lib/prisma";

type AuthorizedActor = Omit<SessionUser, "expiresAt" | "sessionId"> & Pick<SessionUser, "expiresAt" | "sessionId">;

const ACTIVE_PAYMENT_REQUEST_STATUSES = ["GATEWAY_SETUP_REQUIRED", "PAYMENT_PENDING", "PAID_TO_PLATFORM", "WALLET_CREDITED", "DISPUTED"];
const DEFAULT_FREELANCER_COMMISSION_PERCENT = 30;

function makeId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function makePhonePeOrderId() {
  return `GXEDITOR${Date.now()}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function sanitizeText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function parsePositiveAmount(value: unknown) {
  const amount = Math.round(Number(value ?? 0));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function canManageTenant(actor: AuthorizedActor, tenantId: string) {
  if (actor.role === "SUPER_ADMIN") return true;
  return (actor.role === "ADMIN" || actor.role === "MANAGER") && Boolean(actor.tenantId) && actor.tenantId === tenantId;
}

function canViewPaymentRequest(
  actor: AuthorizedActor,
  request: {
    tenantId: string;
    freelancerId: string;
  },
) {
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "FREELANCER") return request.freelancerId === actor.userId;
  return canManageTenant(actor, request.tenantId);
}

function classifyPhonePeState(state: string) {
  const normalized = state.toUpperCase();
  if (["COMPLETED", "SUCCESS", "PAYMENT_SUCCESS"].includes(normalized)) return "success";
  if (["FAILED", "CANCELLED", "EXPIRED", "PAYMENT_ERROR", "PAYMENT_FAILED", "TXN_FAILED", "TRANSACTION_FAILED"].includes(normalized)) {
    return "failed";
  }
  return "pending";
}

async function getFreelancerCommissionPercent(freelancerId: string) {
  const user = await prisma.appAuthUser.findUnique({
    where: { id: freelancerId },
    select: {
      packageId: true,
      subscriptions: {
        where: { status: { in: ["ACTIVE", "TRIALING"] } },
        include: { package: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });

  const activePackage = user?.subscriptions[0]?.package;
  const fallbackPackage = user?.packageId
    ? await prisma.package.findUnique({ where: { id: user.packageId } })
    : null;
  const packageCommission = activePackage?.commissionOverridePercent ?? fallbackPackage?.commissionOverridePercent;
  const commission = Number(packageCommission ?? DEFAULT_FREELANCER_COMMISSION_PERCENT);
  return Number.isFinite(commission) && commission >= 0 ? commission : DEFAULT_FREELANCER_COMMISSION_PERCENT;
}

function computeWalletSplit(grossAmount: number, commissionPercent: number) {
  const platformCommissionAmount = Math.max(0, Math.round((grossAmount * commissionPercent) / 100));
  return {
    platformCommissionAmount,
    freelancerWalletAmount: Math.max(0, grossAmount - platformCommissionAmount),
  };
}

async function createPhonePeEditorCheckout(input: {
  amount: number;
  assignmentId: string;
  merchantOrderId: string;
  origin: string;
  paymentRequestId: string;
  title: string;
}) {
  const redirectUrl = new URL("/api/payments/phonepe/editor-payment-return", input.origin);
  redirectUrl.searchParams.set("assignmentId", input.assignmentId);
  redirectUrl.searchParams.set("paymentRequestId", input.paymentRequestId);
  redirectUrl.searchParams.set("merchantOrderId", input.merchantOrderId);

  const payload = {
    merchantOrderId: input.merchantOrderId,
    amount: Math.max(1, Math.round(input.amount * 100)),
    expireAfter: 1200,
    metaInfo: {
      udf1: "gigxomi-editor-internal-payment",
      udf2: input.assignmentId.slice(0, 64),
      udf3: input.paymentRequestId.slice(0, 64),
      udf4: input.title.slice(0, 64),
      udf5: "wallet-credit-after-completion",
    },
    paymentFlow: {
      type: "PG_CHECKOUT",
      message: input.title.slice(0, 120) || "Gigxomi editor payment",
      merchantUrls: {
        redirectUrl: redirectUrl.toString(),
      },
    },
  };

  const raw = await new PhonePeHttpClient().request("/checkout/v2/pay", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const paymentLink = readPhonePeRedirectUrl(raw);
  if (!paymentLink) {
    throw new Error("PhonePe did not return a checkout URL for the editor payment request.");
  }
  return { paymentLink, raw };
}

export async function listPaymentRequestsForActor(actor: AuthorizedActor, audience?: string | null) {
  const normalizedAudience = sanitizeText(audience).toLowerCase();

  if (actor.role === "FREELANCER" || normalizedAudience === "editor") {
    if (actor.role !== "SUPER_ADMIN" && actor.role !== "FREELANCER") {
      return { ok: false as const, status: 403, error: "Only freelancers can view editor payment requests." };
    }
    const requests = await prisma.appPaymentRequest.findMany({
      where: actor.role === "SUPER_ADMIN" ? undefined : { freelancerId: actor.userId },
      orderBy: { createdAt: "desc" },
    });
    return { ok: true as const, requests };
  }

  if (actor.role === "SUPER_ADMIN") {
    const requests = await prisma.appPaymentRequest.findMany({ orderBy: { createdAt: "desc" } });
    return { ok: true as const, requests };
  }

  if (!actor.tenantId) {
    return { ok: false as const, status: 403, error: "Agency tenant is required." };
  }

  const requests = await prisma.appPaymentRequest.findMany({
    where: { tenantId: actor.tenantId },
    orderBy: { createdAt: "desc" },
  });
  return { ok: true as const, requests };
}

export async function listWalletEntriesForActor(actor: AuthorizedActor) {
  const where =
    actor.role === "SUPER_ADMIN"
      ? undefined
      : actor.role === "FREELANCER"
        ? { freelancerId: actor.userId }
        : actor.tenantId
          ? { tenantId: actor.tenantId }
          : null;

  if (where === null) {
    return { ok: false as const, status: 403, error: "Agency tenant is required." };
  }

  const entries = await prisma.appFreelancerWalletEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return { ok: true as const, entries };
}

export async function createAssignmentPaymentRequest(
  actor: AuthorizedActor,
  assignmentId: string,
  input: {
    requestedAmount?: unknown;
    message?: unknown;
    chatThreadId?: unknown;
  },
  options: {
    origin?: string;
  } = {},
) {
  const assignment = await prisma.appAssignmentRecord.findUnique({ where: { id: assignmentId.trim() } });
  if (!assignment) return { ok: false as const, status: 404, error: "Assignment was not found." };

  if (actor.role !== "SUPER_ADMIN" && (actor.role !== "FREELANCER" || assignment.freelancerId !== actor.userId)) {
    return { ok: false as const, status: 403, error: "Only the assigned freelancer can request payment." };
  }

  if (assignment.status !== "COMPLETED") {
    return { ok: false as const, status: 409, error: "Payment can be requested only after the agency marks the assignment completed." };
  }

  const existing = await prisma.appPaymentRequest.findFirst({
    where: {
      assignmentId: assignment.id,
      status: { in: ACTIVE_PAYMENT_REQUEST_STATUSES },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { ok: true as const, duplicate: true, request: existing };
  }

  const requestedAmount = parsePositiveAmount(input.requestedAmount ?? assignment.budgetAmount);
  if (!requestedAmount) {
    return { ok: false as const, status: 400, error: "Requested amount is required." };
  }

  if (requestedAmount > assignment.budgetAmount) {
    return { ok: false as const, status: 400, error: "Requested amount cannot exceed the assignment budget." };
  }

  const origin = sanitizeText(options.origin);
  if (!origin) {
    return { ok: false as const, status: 400, error: "Payment origin is required to create a PhonePe checkout." };
  }

  const requestId = makeId("payreq");
  const merchantOrderId = makePhonePeOrderId();
  const commissionPercent = await getFreelancerCommissionPercent(assignment.freelancerId);
  const { platformCommissionAmount, freelancerWalletAmount } = computeWalletSplit(requestedAmount, commissionPercent);

  let checkout: Awaited<ReturnType<typeof createPhonePeEditorCheckout>>;
  try {
    checkout = await createPhonePeEditorCheckout({
      amount: requestedAmount,
      assignmentId: assignment.id,
      merchantOrderId,
      origin,
      paymentRequestId: requestId,
      title: assignment.title,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "PhonePe checkout could not be created for this payment request.";
    const now = new Date();
    const [request, updatedAssignment] = await prisma.$transaction([
      prisma.appPaymentRequest.create({
        data: {
          id: requestId,
          assignmentId: assignment.id,
          tenantId: assignment.tenantId,
          agencyUserId: assignment.agencyUserId,
          agencyName: assignment.agencyName,
          freelancerId: assignment.freelancerId,
          freelancerName: assignment.freelancerName,
          title: assignment.title,
          requestedAmount,
          approvedAmount: requestedAmount,
          commissionPercent,
          platformCommissionAmount,
          freelancerWalletAmount,
          message: sanitizeText(input.message),
          status: "GATEWAY_SETUP_REQUIRED",
          chatThreadId: sanitizeText(input.chatThreadId) || assignment.chatThreadId,
          provider: "PHONEPE",
          merchantOrderId,
          paymentLink: null,
          gatewayStatus: "CONFIG_REQUIRED",
          gatewayRawResponse: {
            error: errorMessage,
            provider: "PHONEPE",
          } satisfies Prisma.InputJsonObject,
          requestedAt: now,
          metadata: {
            collectionModel: "platform_collects_full_amount",
            payoutModel: "manual_editor_payout_after_wallet_credit",
            createdFrom: "assignment_completion",
            createdByUserId: actor.userId,
            gatewaySetupRequired: true,
          } satisfies Prisma.InputJsonObject,
        },
      }),
      prisma.appAssignmentRecord.update({
        where: { id: assignment.id },
        data: {
          status: "PAYMENT_REQUESTED",
          metadata: {
            ...((assignment.metadata as Prisma.JsonObject) ?? {}),
            latestPaymentRequestAt: now.toISOString(),
            latestPaymentProvider: "PHONEPE",
            latestPaymentGatewayStatus: "CONFIG_REQUIRED",
          },
        },
      }),
    ]);

    await createAppNotification({
      userId: assignment.agencyUserId,
      tenantId: assignment.tenantId,
      type: "payment_request_gateway_setup_required",
      title: "PhonePe setup required",
      message: `${assignment.freelancerName} requested INR ${requestedAmount.toLocaleString("en-IN")} for ${assignment.title}, but PhonePe checkout needs configuration.`,
      entityType: "payment_request",
      entityId: request.id,
    });

    return {
      ok: false as const,
      status: 502,
      error: errorMessage,
      request,
      assignment: updatedAssignment,
    };
  }

  const now = new Date();
  const [request, updatedAssignment] = await prisma.$transaction([
    prisma.appPaymentRequest.create({
      data: {
        id: requestId,
        assignmentId: assignment.id,
        tenantId: assignment.tenantId,
        agencyUserId: assignment.agencyUserId,
        agencyName: assignment.agencyName,
        freelancerId: assignment.freelancerId,
        freelancerName: assignment.freelancerName,
        title: assignment.title,
        requestedAmount,
        approvedAmount: requestedAmount,
        commissionPercent,
        platformCommissionAmount,
        freelancerWalletAmount,
        message: sanitizeText(input.message),
        status: "PAYMENT_PENDING",
        chatThreadId: sanitizeText(input.chatThreadId) || assignment.chatThreadId,
        provider: "PHONEPE",
        merchantOrderId,
        paymentLink: checkout.paymentLink,
        gatewayStatus: "PENDING",
        gatewayRawResponse: checkout.raw as Prisma.InputJsonValue,
        requestedAt: now,
        metadata: {
          collectionModel: "platform_collects_full_amount",
          payoutModel: "manual_editor_payout_after_wallet_credit",
          createdFrom: "assignment_completion",
          createdByUserId: actor.userId,
        } satisfies Prisma.InputJsonObject,
      },
    }),
    prisma.appAssignmentRecord.update({
      where: { id: assignment.id },
      data: {
        status: "PAYMENT_REQUESTED",
        metadata: {
          ...((assignment.metadata as Prisma.JsonObject) ?? {}),
          latestPaymentRequestAt: now.toISOString(),
          latestPaymentProvider: "PHONEPE",
        },
      },
    }),
  ]);

  await createAppNotification({
    userId: assignment.agencyUserId,
    tenantId: assignment.tenantId,
    type: "payment_request_created",
    title: "Editor payment request",
    message: `${assignment.freelancerName} requested INR ${requestedAmount.toLocaleString("en-IN")} for ${assignment.title}. Pay through PhonePe to credit the wallet.`,
    entityType: "payment_request",
    entityId: request.id,
  });

  return { ok: true as const, duplicate: false, request, assignment: updatedAssignment };
}

export async function syncPhonePeEditorPaymentRequest(input: {
  merchantOrderId?: string;
  paymentRequestId?: string;
  raw?: unknown;
  state?: string;
}) {
  const request = input.paymentRequestId
    ? await prisma.appPaymentRequest.findUnique({ where: { id: input.paymentRequestId } })
    : input.merchantOrderId
      ? await prisma.appPaymentRequest.findUnique({ where: { merchantOrderId: input.merchantOrderId } })
      : null;
  if (!request) return { ok: false as const, status: 404, error: "Payment request was not found." };

  const state = sanitizeText(input.state) || readPhonePeState(input.raw);
  const gatewayReference = readPhonePeReference(input.raw);
  const classified = classifyPhonePeState(state);
  const now = new Date();

  if (classified === "failed") {
    const updated = await prisma.appPaymentRequest.update({
      where: { id: request.id },
      data: {
        status: "PAYMENT_FAILED",
        gatewayStatus: "FAILED",
        gatewayReference: gatewayReference || request.gatewayReference,
        gatewayRawResponse: (input.raw as Prisma.InputJsonValue) ?? request.gatewayRawResponse,
      },
    });
    return { ok: true as const, request: updated, walletEntry: null };
  }

  if (classified !== "success") {
    const updated = await prisma.appPaymentRequest.update({
      where: { id: request.id },
      data: {
        gatewayStatus: "PENDING",
        gatewayReference: gatewayReference || request.gatewayReference,
        gatewayRawResponse: (input.raw as Prisma.InputJsonValue) ?? request.gatewayRawResponse,
      },
    });
    return { ok: true as const, request: updated, walletEntry: null };
  }

  const [updatedRequest, walletEntry, updatedAssignment] = await prisma.$transaction([
    prisma.appPaymentRequest.update({
      where: { id: request.id },
      data: {
        status: "WALLET_CREDITED",
        gatewayStatus: "SUCCESS",
        gatewayReference: gatewayReference || request.gatewayReference,
        gatewayRawResponse: (input.raw as Prisma.InputJsonValue) ?? request.gatewayRawResponse,
        paidAt: now,
        walletCreditedAt: now,
      },
    }),
    prisma.appFreelancerWalletEntry.upsert({
      where: { paymentRequestId: request.id },
      create: {
        id: makeId("wallet"),
        freelancerId: request.freelancerId,
        tenantId: request.tenantId,
        assignmentId: request.assignmentId,
        paymentRequestId: request.id,
        title: request.title,
        grossAmount: request.requestedAmount,
        commissionPercent: request.commissionPercent,
        commissionAmount: request.platformCommissionAmount,
        netAmount: request.freelancerWalletAmount,
        status: "AVAILABLE",
        source: "PHONEPE_PLATFORM_COLLECTION",
        availableAt: now,
        metadata: {
          payoutModel: "manual_payout_pending",
          merchantOrderId: request.merchantOrderId,
        } satisfies Prisma.InputJsonObject,
      },
      update: {
        status: "AVAILABLE",
        availableAt: now,
      },
    }),
    prisma.appAssignmentRecord.update({
      where: { id: request.assignmentId },
      data: { status: "PAYMENT_APPROVED" },
    }),
  ]);

  await Promise.all([
    createAppNotification({
      userId: request.freelancerId,
      tenantId: request.tenantId,
      type: "wallet_credit_available",
      title: "Wallet credited",
      message: `INR ${request.freelancerWalletAmount.toLocaleString("en-IN")} is available in your Gigxomi wallet for ${request.title}.`,
      entityType: "wallet_entry",
      entityId: walletEntry.id,
    }),
    createAppNotification({
      userId: request.agencyUserId,
      tenantId: request.tenantId,
      type: "platform_payment_received",
      title: "PhonePe payment received",
      message: `Gigxomi received INR ${request.requestedAmount.toLocaleString("en-IN")} and credited ${request.freelancerName}'s wallet.`,
      entityType: "payment_request",
      entityId: updatedRequest.id,
    }),
  ]);

  return { ok: true as const, request: updatedRequest, walletEntry, assignment: updatedAssignment };
}

export async function updateAssignmentPaymentRequest(
  actor: AuthorizedActor,
  paymentRequestId: string,
  input: {
    action?: unknown;
    rejectedReason?: unknown;
    paymentProof?: unknown;
    note?: unknown;
  },
) {
  const request = await prisma.appPaymentRequest.findUnique({ where: { id: paymentRequestId.trim() } });
  if (!request) return { ok: false as const, status: 404, error: "Payment request was not found." };
  if (!canViewPaymentRequest(actor, request)) {
    return { ok: false as const, status: 403, error: "You do not have access to this payment request." };
  }

  const action = sanitizeText(input.action).toUpperCase();
  const assignment = await prisma.appAssignmentRecord.findUnique({ where: { id: request.assignmentId } });

  if (action === "CANCEL") {
    if (actor.role !== "SUPER_ADMIN" && (actor.role !== "FREELANCER" || request.freelancerId !== actor.userId)) {
      return { ok: false as const, status: 403, error: "Only the requester can cancel this payment request." };
    }
    if (request.status !== "PAYMENT_PENDING") {
      return { ok: false as const, status: 409, error: "Only unpaid payment requests can be cancelled." };
    }
    const [updatedRequest, updatedAssignment] = await prisma.$transaction([
      prisma.appPaymentRequest.update({
        where: { id: request.id },
        data: { status: "CANCELLED", gatewayStatus: "CANCELLED" },
      }),
      prisma.appAssignmentRecord.update({
        where: { id: request.assignmentId },
        data: { status: "COMPLETED" },
      }),
    ]);
    await createAppNotification({
      userId: request.agencyUserId,
      tenantId: request.tenantId,
      type: "payment_request_cancelled",
      title: "Payment request cancelled",
      message: `${request.freelancerName} cancelled the payment request for ${request.title}.`,
      entityType: "payment_request",
      entityId: updatedRequest.id,
    });
    return { ok: true as const, request: updatedRequest, assignment: updatedAssignment };
  }

  if (!canManageTenant(actor, request.tenantId)) {
    return { ok: false as const, status: 403, error: "Only agency finance can review this payment request." };
  }

  if (action === "REJECT") {
    if (request.status !== "PAYMENT_PENDING") {
      return { ok: false as const, status: 409, error: "Only unpaid payment requests can be rejected." };
    }
    const rejectedReason = sanitizeText(input.rejectedReason || input.note);
    if (!rejectedReason) {
      return { ok: false as const, status: 400, error: "Rejection reason is required." };
    }

    const [updatedRequest, updatedAssignment] = await prisma.$transaction([
      prisma.appPaymentRequest.update({
        where: { id: request.id },
        data: {
          status: "REJECTED",
          gatewayStatus: "REJECTED",
          rejectedReason,
          metadata: {
            ...((request.metadata as Prisma.JsonObject) ?? {}),
            reviewedByUserId: actor.userId,
          },
        },
      }),
      prisma.appAssignmentRecord.update({
        where: { id: request.assignmentId },
        data: { status: assignment?.status === "PAYMENT_REQUESTED" ? "COMPLETED" : assignment?.status },
      }),
    ]);
    await createAppNotification({
      userId: request.freelancerId,
      tenantId: request.tenantId,
      type: "payment_request_rejected",
      title: "Payment request rejected",
      message: `${request.agencyName} rejected the payment request for ${request.title}.`,
      entityType: "payment_request",
      entityId: updatedRequest.id,
    });
    return { ok: true as const, request: updatedRequest, assignment: updatedAssignment };
  }

  if (action === "MARK_EDITOR_PAYOUT_PAID") {
    if (request.status !== "WALLET_CREDITED") {
      return { ok: false as const, status: 409, error: "Wallet must be credited before manual editor payout can be marked paid." };
    }
    const now = new Date();
    const [updatedRequest, updatedWalletEntry, updatedAssignment] = await prisma.$transaction([
      prisma.appPaymentRequest.update({
        where: { id: request.id },
        data: {
          status: "EDITOR_PAYOUT_PAID",
          paymentProof: sanitizeText(input.paymentProof),
          metadata: {
            ...((request.metadata as Prisma.JsonObject) ?? {}),
            manualPayoutPaidByUserId: actor.userId,
            manualPayoutNote: sanitizeText(input.note),
          },
        },
      }),
      prisma.appFreelancerWalletEntry.update({
        where: { paymentRequestId: request.id },
        data: {
          status: "PAID",
          paidAt: now,
        },
      }),
      prisma.appAssignmentRecord.update({
        where: { id: request.assignmentId },
        data: { status: "PAID" },
      }),
    ]);
    await createAppNotification({
      userId: request.freelancerId,
      tenantId: request.tenantId,
      type: "manual_payout_paid",
      title: "Manual payout marked paid",
      message: `Manual payout for ${request.title} was marked paid.`,
      entityType: "payment_request",
      entityId: updatedRequest.id,
    });
    return { ok: true as const, request: updatedRequest, walletEntry: updatedWalletEntry, assignment: updatedAssignment };
  }

  if (action === "DISPUTE") {
    const [updatedRequest, updatedAssignment] = await prisma.$transaction([
      prisma.appPaymentRequest.update({
        where: { id: request.id },
        data: {
          status: "DISPUTED",
          metadata: {
            ...((request.metadata as Prisma.JsonObject) ?? {}),
            disputeNote: sanitizeText(input.note),
            disputedByUserId: actor.userId,
          },
        },
      }),
      prisma.appAssignmentRecord.update({
        where: { id: request.assignmentId },
        data: { status: "DISPUTED" },
      }),
    ]);
    return { ok: true as const, request: updatedRequest, assignment: updatedAssignment };
  }

  return { ok: false as const, status: 400, error: "Choose reject, dispute, cancel, or mark editor payout paid." };
}
