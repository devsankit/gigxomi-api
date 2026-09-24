import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { claimSalesLeadPoolItem, createSalesLead, createSalesLeadPoolItem, getSalesSnapshotForRole, updateSalesLead, updateSalesLeadStage, type SalesLeadStage } from "@/lib/gigxomi/sales-store";

const salesLeadStages = new Set<SalesLeadStage>([
  "NEW", "ASSIGNED", "CONTACTED", "INTERESTED", "WEBINAR_INVITED", "WEBINAR_ATTENDED", "FOLLOW_UP", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST", "NOT_REACHABLE", "RECYCLED", "QUALIFIED", "QUOTE_SENT", "PAYMENT_PENDING", "PAID", "HANDOFF", "CONVERTED_FREE", "CLOSED", "LOST",
]);

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const snapshot = await getSalesSnapshotForRole(authorization.session);
  return NextResponse.json({ ok: true, leadPool: snapshot.visibleLeadPool, leads: snapshot.visibleLeads, agents: snapshot.visibleAgents });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid lead details." }, { status: 400 });
  const snapshot = await getSalesSnapshotForRole(authorization.session);

  if (body.action === "stage") {
    const leadId = String(body.leadId ?? "");
    if (!snapshot.visibleLeads.some((lead) => lead.id === leadId)) {
      return NextResponse.json({ ok: false, error: "You do not have access to this lead." }, { status: 403 });
    }
    const stage = String(body.stage ?? "NEW") as SalesLeadStage;
    if (!salesLeadStages.has(stage)) return NextResponse.json({ ok: false, error: "Choose a valid lead stage." }, { status: 400 });
    const lead = await updateSalesLeadStage({
      leadId,
      stage,
      note: typeof body.note === "string" ? body.note : undefined,
      actorUserId: authorization.session.userId,
    });
    return lead ? NextResponse.json({ ok: true, lead }) : NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });
  }

  if (body.action === "claim") {
    const agentId = String(body.agentId ?? snapshot.currentAgent?.id ?? "");
    if (!agentId) return NextResponse.json({ ok: false, error: "Sales agent profile not found." }, { status: 400 });
    try {
      const result = await claimSalesLeadPoolItem({
        poolItemId: String(body.poolItemId ?? ""),
        agentId,
        actorUserId: authorization.session.userId,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to claim lead." }, { status: 400 });
    }
  }

  if (body.action === "queue") {
    if (authorization.session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ ok: false, error: "Only super-admin can add round-robin queue leads." }, { status: 403 });
    }
    const lead = await createSalesLeadPoolItem({
      assignedAgentId: typeof body.assignedAgentId === "string" ? body.assignedAgentId : null,
      customerName: String(body.customerName ?? ""),
      customerPhone: String(body.customerPhone ?? ""),
      customerEmail: String(body.customerEmail ?? ""),
      source: String(body.source ?? "round_robin"),
      serviceInterest: String(body.serviceInterest ?? "Editor deal"),
      segment: String(body.segment ?? ""),
      priority: String(body.priority ?? "normal"),
      budgetAmount: Number(body.budgetAmount ?? 0),
      notes: String(body.notes ?? ""),
    });
    return NextResponse.json({ ok: true, lead });
  }

  if (body.action === "update") {
    const leadId = String(body.leadId ?? "");
    if (!snapshot.visibleLeads.some((lead) => lead.id === leadId)) {
      return NextResponse.json({ ok: false, error: "You do not have access to this lead." }, { status: 403 });
    }
    const lead = await updateSalesLead({
      leadId,
      customerName: typeof body.customerName === "string" ? body.customerName : undefined,
      customerPhone: typeof body.customerPhone === "string" ? body.customerPhone : undefined,
      customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
      serviceInterest: typeof body.serviceInterest === "string" ? body.serviceInterest : undefined,
      segment: typeof body.segment === "string" ? body.segment : undefined,
      priority: typeof body.priority === "string" ? body.priority : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : typeof body.tags === "string" ? body.tags.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
      budgetAmount: Number.isFinite(Number(body.budgetAmount)) ? Number(body.budgetAmount) : undefined,
      followUpAt: typeof body.followUpAt === "string" ? body.followUpAt : undefined,
      lastContactedAt: typeof body.lastContactedAt === "string" ? body.lastContactedAt : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
      actorUserId: authorization.session.userId,
    });
    return NextResponse.json({ ok: true, lead });
  }

  const assignedAgentId = String(body.assignedAgentId ?? snapshot.currentAgent?.id ?? "");
  if (!assignedAgentId) return NextResponse.json({ ok: false, error: "Choose a sales agent for this lead." }, { status: 400 });

  const lead = await createSalesLead({
    assignedAgentId,
    customerName: String(body.customerName ?? ""),
    customerPhone: String(body.customerPhone ?? ""),
    customerEmail: String(body.customerEmail ?? ""),
    source: String(body.source ?? "manual"),
    serviceInterest: String(body.serviceInterest ?? "Editor deal"),
    segment: String(body.segment ?? ""),
    priority: String(body.priority ?? "normal"),
    tags: typeof body.tags === "string" ? body.tags.split(",").map((item) => item.trim()).filter(Boolean) : [],
    budgetAmount: Number(body.budgetAmount ?? 0),
    notes: String(body.notes ?? ""),
    actorUserId: authorization.session.userId,
  });

  return NextResponse.json({ ok: true, lead });
}
