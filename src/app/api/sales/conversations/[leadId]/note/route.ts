import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { addSalesLeadTimelineNote } from "@/lib/gigxomi/sales-operating-system-store";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";

export async function POST(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const { leadId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send a note." }, { status: 400 });

  const sales = await getSalesSnapshotForRole(authorization.session);
  const lead = sales.visibleLeads.find((item) => item.id === leadId);
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });
  const noteBody = String(body.body ?? "").trim();
  if (!noteBody) return NextResponse.json({ ok: false, error: "Write a note before saving." }, { status: 400 });

  const entry = await addSalesLeadTimelineNote({
    leadId,
    agentId: lead.assignedAgentId,
    userId: authorization.session.userId,
    type: typeof body.type === "string" ? body.type : "NOTE",
    body: noteBody,
    metadata: { stage: lead.stage },
  });
  return NextResponse.json({ ok: true, entry });
}
