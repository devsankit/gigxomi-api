import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { inviteSalesLeadToWebinar } from "@/lib/gigxomi/sales-operating-system-store";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Choose a webinar and lead." }, { status: 400 });

  const sales = await getSalesSnapshotForRole(authorization.session);
  const leadId = String(body.leadId ?? "");
  const lead = sales.visibleLeads.find((item) => item.id === leadId);
  const agentId = authorization.session.role === "SUPER_ADMIN" ? String(body.agentId ?? lead?.assignedAgentId ?? "") : sales.currentAgent?.id ?? "";
  if (!agentId || !leadId) return NextResponse.json({ ok: false, error: "Choose a valid lead and agent." }, { status: 400 });

  const invite = await inviteSalesLeadToWebinar({
    webinarId: String(body.webinarId ?? ""),
    leadId,
    agentId,
    notes: typeof body.notes === "string" ? body.notes : undefined,
  });
  return NextResponse.json({ ok: true, invite });
}
