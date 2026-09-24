import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { createSalesDeal, getSalesSnapshotForRole, type SalesDealStatus } from "@/lib/gigxomi/sales-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const snapshot = await getSalesSnapshotForRole(authorization.session);
  return NextResponse.json({ ok: true, deals: snapshot.visibleDeals, earnings: snapshot.visibleEarnings });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid deal details." }, { status: 400 });

  const snapshot = await getSalesSnapshotForRole(authorization.session);
  const agentId = String(body.agentId ?? snapshot.currentAgent?.id ?? "");
  const assignmentId = String(body.assignmentId ?? "");

  if (!agentId || !assignmentId) {
    return NextResponse.json({ ok: false, error: "Deal needs an agent and lead assignment." }, { status: 400 });
  }

  const deal = await createSalesDeal({
    assignmentId,
    agentId,
    title: String(body.title ?? "Editor deal"),
    agreedAmount: Number(body.agreedAmount ?? 0),
    paidAmount: Number(body.paidAmount ?? 0),
    status: String(body.status ?? "DRAFT") as SalesDealStatus,
    packageId: typeof body.packageId === "string" && body.packageId ? body.packageId : null,
    serviceId: typeof body.serviceId === "string" && body.serviceId ? body.serviceId : null,
    quoteId: typeof body.quoteId === "string" && body.quoteId ? body.quoteId : null,
    paymentTransactionId:
      typeof body.paymentTransactionId === "string" && body.paymentTransactionId ? body.paymentTransactionId : null,
    referralCodeId: typeof body.referralCodeId === "string" && body.referralCodeId ? body.referralCodeId : null,
    paymentReference: typeof body.paymentReference === "string" ? body.paymentReference : null,
    handoffNotes: typeof body.handoffNotes === "string" ? body.handoffNotes : "",
  });

  return NextResponse.json({ ok: true, deal });
}
