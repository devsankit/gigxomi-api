import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesSnapshotForRole, saveSalesPayoutInfo } from "@/lib/gigxomi/sales-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const snapshot = await getSalesSnapshotForRole(authorization.session);
  if (!snapshot.currentAgent) {
    return NextResponse.json({ ok: false, error: "Sales profile not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const payoutInfo = {
    method: String(body?.method ?? "upi").trim(),
    upiId: String(body?.upiId ?? "").trim(),
    bankName: String(body?.bankName ?? "").trim(),
    accountName: String(body?.accountName ?? "").trim(),
    accountNumber: String(body?.accountNumber ?? "").trim(),
    ifsc: String(body?.ifsc ?? "").trim(),
    notes: String(body?.notes ?? "").trim(),
  };

  const agent = await saveSalesPayoutInfo({ agentId: snapshot.currentAgent.id, payoutInfo });
  return NextResponse.json({ ok: true, agent });
}
