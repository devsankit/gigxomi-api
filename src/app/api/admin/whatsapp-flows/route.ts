import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  deleteAgencyWhatsAppFlow,
  listAgencyWhatsAppFlowRuns,
  listAgencyWhatsAppFlows,
  saveAgencyWhatsAppFlow,
  updateAgencyWhatsAppFlowMeta,
} from "@/lib/gigxomi/agency-whatsapp-flow-store";
import type { SuperAdminWhatsAppFlow } from "@/lib/gigxomi/super-admin-whatsapp-flow-store";
import { validateWhatsAppFlowForServer } from "@/lib/gigxomi/whatsapp-flow-server-validation";

async function agencyScope() {
  const authorization = await requireSessionRole(["ADMIN"]);
  if (!authorization.ok) return authorization;
  if (!authorization.session.tenantId) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "An agency workspace is required." }, { status: 403 }) };
  }
  return { ok: true as const, tenantId: authorization.session.tenantId, agencyName: authorization.session.displayName };
}

async function payload(tenantId: string, agencyName: string) {
  const [flows, runs] = await Promise.all([listAgencyWhatsAppFlows(tenantId, agencyName), listAgencyWhatsAppFlowRuns(tenantId)]);
  return { flows, runs };
}

export async function GET() {
  const scope = await agencyScope();
  if (!scope.ok) return scope.response;
  return NextResponse.json({ ok: true, ...(await payload(scope.tenantId, scope.agencyName)) });
}

export async function POST(request: Request) {
  const scope = await agencyScope();
  if (!scope.ok) return scope.response;
  const body = (await request.json().catch(() => null)) as Partial<SuperAdminWhatsAppFlow> | null;
  if (!body?.name?.trim() || !body.summary?.trim() || !body.status || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    return NextResponse.json({ ok: false, error: "Flow name, summary, status, nodes, and edges are required." }, { status: 400 });
  }
  const errors = validateWhatsAppFlowForServer({
    flow: { id: body.id ?? "draft", name: body.name, status: body.status, triggerMode: body.triggerMode === "KEYWORD" ? "KEYWORD" : "ANY_INCOMING", triggerKeyword: body.triggerKeyword ?? "", nodes: body.nodes, edges: body.edges },
  });
  if (body.status === "ACTIVE" && errors.some((error) => error.severity === "error")) {
    return NextResponse.json({ ok: false, error: "Flow validation failed.", errors }, { status: 400 });
  }
  const flow = await saveAgencyWhatsAppFlow(scope.tenantId, scope.agencyName, {
    id: body.id,
    name: body.name,
    summary: body.summary,
    status: body.status,
    triggerMode: body.triggerMode === "KEYWORD" ? "KEYWORD" : "ANY_INCOMING",
    triggerKeyword: body.triggerKeyword ?? "",
    pluginKey: body.pluginKey,
    pluginStatus: body.pluginStatus,
    pluginVersion: body.pluginVersion,
    nodes: body.nodes,
    edges: body.edges,
  });
  return NextResponse.json({ ok: true, flow, ...(await payload(scope.tenantId, scope.agencyName)) });
}

export async function PATCH(request: Request) {
  const scope = await agencyScope();
  if (!scope.ok) return scope.response;
  const body = (await request.json().catch(() => null)) as { id?: string; name?: string; summary?: string } | null;
  if (!body?.id?.trim()) return NextResponse.json({ ok: false, error: "Flow id is required." }, { status: 400 });
  if (body.name !== undefined && !body.name.trim()) return NextResponse.json({ ok: false, error: "Flow name is required." }, { status: 400 });
  try {
    const flow = await updateAgencyWhatsAppFlowMeta(scope.tenantId, scope.agencyName, { flowId: body.id, name: body.name, summary: body.summary });
    return NextResponse.json({ ok: true, flow, ...(await payload(scope.tenantId, scope.agencyName)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Flow update failed." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const scope = await agencyScope();
  if (!scope.ok) return scope.response;
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id?.trim()) return NextResponse.json({ ok: false, error: "Flow id is required." }, { status: 400 });
  try {
    const flow = await deleteAgencyWhatsAppFlow(scope.tenantId, scope.agencyName, body.id);
    return NextResponse.json({ ok: true, flow, ...(await payload(scope.tenantId, scope.agencyName)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Flow delete failed." }, { status: 400 });
  }
}
