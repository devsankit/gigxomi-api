import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listPaymentRequestsForActor } from "@/lib/gigxomi/app-payment-request-service";

type AccountingAudience = "agency" | "editor";
type AppPaymentRequestRecord = {
  id: string;
  assignmentId: string;
  chatThreadId: string | null;
  agencyName: string;
  title: string;
  requestedAmount: number;
  platformCommissionAmount: number;
  commissionPercent: unknown;
  createdAt: Date;
  freelancerWalletAmount: number;
  freelancerName: string;
  gatewayStatus: string;
  merchantOrderId: string | null;
  paymentLink: string | null;
  provider: string;
  status: string;
};

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toAccountingStatus(status: string) {
  switch (status) {
    case "PAYMENT_PENDING":
      return "Payment pending";
    case "PAYMENT_FAILED":
      return "Payment failed";
    case "WALLET_CREDITED":
      return "Wallet credited";
    case "EDITOR_PAYOUT_PAID":
      return "Editor payout paid";
    case "DISPUTED":
      return "Disputed";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status.replace(/_/g, " ").toLowerCase();
  }
}

export async function GET(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!auth.ok) {
    return auth.response;
  }

  const audienceParam = new URL(request.url).searchParams.get("audience");
  const audience: AccountingAudience = audienceParam === "agency" ? "agency" : "editor";
  const result = await listPaymentRequestsForActor(auth.session, audience);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const records = (result.requests as AppPaymentRequestRecord[]).map((payment) => ({
    id: payment.id,
    assignmentId: payment.assignmentId,
    conversationId: payment.chatThreadId ?? payment.assignmentId,
    customerName: payment.agencyName,
    projectTitle: payment.title,
    title: payment.title,
    amount: payment.requestedAmount,
    commissionAmount: payment.platformCommissionAmount,
    commissionPercent: toNumber(payment.commissionPercent),
    createdAt: payment.createdAt.toISOString(),
    dueLabel: payment.status === "PAYMENT_PENDING" ? "PhonePe collection pending" : undefined,
    freelancerAmount: payment.freelancerWalletAmount,
    freelancerName: payment.freelancerName,
    gatewayStatus: payment.gatewayStatus,
    lane: "internal" as const,
    merchantOrderId: payment.merchantOrderId,
    payerRole: "agency" as const,
    payeeRole: "freelancer" as const,
    paymentLink: payment.paymentLink,
    provider: payment.provider,
    rawStatus: payment.status,
    status: toAccountingStatus(payment.status),
  }));

  const pending = records.filter((item) => !["Wallet credited", "Editor payout paid"].includes(item.status));
  const credited = records.filter((item) => item.status === "Wallet credited");
  const paid = records.filter((item) => item.status === "Editor payout paid");

  return NextResponse.json({
    ok: true,
    audience,
    summary: {
      total: records.length,
      pending: pending.length,
      paid: paid.length,
      credited: credited.length,
      pendingAmount: pending.reduce((sum, item) => sum + item.amount, 0),
      paidAmount: paid.reduce((sum, item) => sum + item.freelancerAmount, 0),
      walletCreditedAmount: credited.reduce((sum, item) => sum + item.freelancerAmount, 0),
      platformCommissionAmount: records.reduce((sum, item) => sum + item.commissionAmount, 0),
    },
    records,
  });
}
