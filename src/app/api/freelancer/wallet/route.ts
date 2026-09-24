import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listWalletEntriesForActor } from "@/lib/gigxomi/app-payment-request-service";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const result = await listWalletEntriesForActor(authorization.session);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const grossEarned = result.entries.reduce((sum, credit) => sum + credit.grossAmount, 0);
  const commissionDeducted = result.entries.reduce((sum, credit) => sum + credit.commissionAmount, 0);
  const pendingClearance = result.entries
    .filter((credit) => credit.status === "PENDING")
    .reduce((sum, credit) => sum + credit.netAmount, 0);
  const availableForWithdrawal = result.entries
    .filter((credit) => credit.status === "AVAILABLE")
    .reduce((sum, credit) => sum + credit.netAmount, 0);

  return NextResponse.json({
    ok: true,
    wallet: {
      grossEarned,
      commissionDeducted,
      pendingClearance,
      availableForWithdrawal,
    },
    ledger: result.entries.map((credit) => ({
      id: credit.id,
      assignmentId: credit.assignmentId,
      commission: credit.commissionAmount,
      commissionPercent: Number(credit.commissionPercent),
      conversationId: credit.assignmentId,
      gross: credit.grossAmount,
      net: credit.netAmount,
      paymentRequestId: credit.paymentRequestId,
      status: credit.status === "AVAILABLE" ? "Available" : credit.status === "PAID" ? "Paid" : "Pending",
      title: credit.title,
      createdAt: credit.createdAt.toISOString(),
    })),
  });
}
