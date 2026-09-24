import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  deleteSalesWhatsAppFlow,
  listSalesWhatsAppFlowRuns,
  listSalesWhatsAppFlows,
  saveSalesWhatsAppFlow,
  updateSalesWhatsAppFlowMeta,
} from "@/lib/gigxomi/sales-whatsapp-flow-store";
import { getSalesAgentAccess } from "@/lib/gigxomi/sales-store";
import type { SuperAdminWhatsAppFlow } from "@/lib/gigxomi/super-admin-whatsapp-flow-store";
import { validateWhatsAppFlowForServer } from "@/lib/gigxomi/whatsapp-flow-server-validation";

async function requireSalesFlowScope() {
  const authorization = await requireSessionRole(["SALES_AGENT"]);
  if (!authorization.ok) return authorization;

  const access = await getSalesAgentAccess(authorization.session.userId);
  if (!access.ok || !access.agent) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Active sales account required." }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    scopeId: access.agent.id,
  };
}

async function salesPayload(scopeId: string) {
  const [flows, runs] = await Promise.all([listSalesWhatsAppFlows(scopeId), listSalesWhatsAppFlowRuns(scopeId)]);
  return { flows, runs };
}

export async function GET() {
  const authorization = await requireSalesFlowScope();
  if (!authorization.ok) return authorization.response;

  const { flows, runs } = await salesPayload(authorization.scopeId);
  return NextResponse.json({ ok: true, flows, runs });
}

export async function POST(request: Request) {
  const authorization = await requireSalesFlowScope();
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as
    | (Partial<SuperAdminWhatsAppFlow> & {
        action?: "save" | "deploy";
      })
    | null;

  if (body?.action === "deploy") {
    return NextResponse.json(
      {
        ok: false,
        error: "Sales chatbot flows are private to this sales account and cannot deploy to agency workspaces from Sales.",
      },
      { status: 403 },
    );
  }

  if (!body?.name?.trim() || !body.summary?.trim() || !body.status || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Flow name, summary, status, nodes, and edges are required.",
      },
      { status: 400 },
    );
  }

  const errors = validateWhatsAppFlowForServer({
    flow: {
      id: body.id ?? "draft",
      name: body.name,
      status: body.status,
      triggerMode: body.triggerMode === "ANY_INCOMING" ? "ANY_INCOMING" : "KEYWORD",
      triggerKeyword: body.triggerKeyword ?? "Get OTP",
      nodes: body.nodes,
      edges: body.edges,
    },
  });
  if (body.status === "ACTIVE" && errors.some((error) => error.severity === "error")) {
    return NextResponse.json({ ok: false, error: "Flow validation failed.", errors }, { status: 400 });
  }

  const flow = await saveSalesWhatsAppFlow(authorization.scopeId, {
    id: body.id,
    name: body.name,
    summary: body.summary,
    status: body.status,
    triggerMode: body.triggerMode === "ANY_INCOMING" ? "ANY_INCOMING" : "KEYWORD",
    triggerKeyword: body.triggerKeyword ?? "Get OTP",
    pluginKey: body.pluginKey,
    pluginStatus: body.pluginStatus,
    pluginVersion: body.pluginVersion,
    nodes: body.nodes,
    edges: body.edges,
  });
  const { flows, runs } = await salesPayload(authorization.scopeId);

  return NextResponse.json({ ok: true, flow, flows, runs });
}

export async function PATCH(request: Request) {
  const authorization = await requireSalesFlowScope();
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as { id?: string; name?: string; summary?: string } | null;
  if (!body?.id?.trim()) {
    return NextResponse.json({ ok: false, error: "Flow id is required." }, { status: 400 });
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json({ ok: false, error: "Flow name is required." }, { status: 400 });
  }

  try {
    const flow = await updateSalesWhatsAppFlowMeta(authorization.scopeId, {
      flowId: body.id,
      name: body.name,
      summary: body.summary,
    });
    const { flows, runs } = await salesPayload(authorization.scopeId);
    return NextResponse.json({ ok: true, flow, flows, runs });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Flow update failed." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const authorization = await requireSalesFlowScope();
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id?.trim()) {
    return NextResponse.json({ ok: false, error: "Flow id is required." }, { status: 400 });
  }

  try {
    const flow = await deleteSalesWhatsAppFlow(authorization.scopeId, body.id);
    const { flows, runs } = await salesPayload(authorization.scopeId);
    return NextResponse.json({ ok: true, flow, flows, runs });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Flow delete failed." }, { status: 400 });
  }
}
