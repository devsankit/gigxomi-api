import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { claimSalesLeadPoolItem, getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const snapshot = await getSalesSnapshotForRole(authorization.session);
  const agents = snapshot.agents.filter((agent) => agent.status === "ACTIVE" && agent.canClaimLeads);
  const openLeads = snapshot.visibleLeadPool.filter((lead) => lead.status === "OPEN" && !lead.assignedAgentId);
  const limit = Math.max(1, Number(body?.limit ?? openLeads.length));
  const assignments = [];

  for (const [index, lead] of openLeads.slice(0, limit).entries()) {
    const agent = agents[index % Math.max(agents.length, 1)];
    if (!agent) break;
    const result = await claimSalesLeadPoolItem({ poolItemId: lead.id, agentId: agent.id, actorUserId: authorization.session.userId });
    assignments.push({ leadId: result.lead.id, agentId: agent.id, poolItemId: result.poolItem.id });
  }

  return NextResponse.json({ ok: true, assigned: assignments.length, assignments });
}
