import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesSnapshotForRole, requestSalesPayout, updateSalesPayoutStatus, type SalesPayoutStatus } from "@/lib/gigxomi/sales-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const snapshot = await getSalesSnapshotForRole(authorization.session);
  return NextResponse.json({ ok: true, payouts: snapshot.visiblePayouts });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid payout details." }, { status: 400 });

  if (body.action === "status") {
    if (authorization.session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ ok: false, error: "Only super-admin can approve or pay sales payouts." }, { status: 403 });
    }
    const payout = await updateSalesPayoutStatus({
      payoutId: String(body.payoutId ?? ""),
      status: String(body.status ?? "REQUESTED") as SalesPayoutStatus,
      note: typeof body.note === "string" ? body.note : undefined,
    });
    return payout ? NextResponse.json({ ok: true, payout }) : NextResponse.json({ ok: false, error: "Payout not found." }, { status: 404 });
  }

  const snapshot = await getSalesSnapshotForRole(authorization.session);
  const agentId = String(body.agentId ?? snapshot.currentAgent?.id ?? "");
  if (!agentId) return NextResponse.json({ ok: false, error: "Sales agent profile not found." }, { status: 400 });

  const payout = await requestSalesPayout({
    agentId,
    amount: Number(body.amount ?? 0),
    note: typeof body.note === "string" ? body.note : "",
  });

  return NextResponse.json({ ok: true, payout });
}
