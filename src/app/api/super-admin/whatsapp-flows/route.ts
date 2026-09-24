import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  deleteSuperAdminWhatsAppFlow,
  deploySuperAdminWhatsAppFlow,
  listSuperAdminWhatsAppFlowRuns,
  listSuperAdminWhatsAppFlows,
  saveSuperAdminWhatsAppFlow,
  updateSuperAdminWhatsAppFlowMeta,
  type SuperAdminWhatsAppFlow,
} from "@/lib/gigxomi/super-admin-whatsapp-flow-store";
import { validateWhatsAppFlowForServer } from "@/lib/gigxomi/whatsapp-flow-server-validation";
import { getWhatsAppRuntimeStatus, listWhatsAppRuntimeRuns } from "@/lib/gigxomi/whatsapp-runtime-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const [flows, runs, runtimeRuns, runtimeStatus] = await Promise.all([
    listSuperAdminWhatsAppFlows(),
    listSuperAdminWhatsAppFlowRuns(),
    listWhatsAppRuntimeRuns(25),
    getWhatsAppRuntimeStatus(),
  ]);

  return NextResponse.json({
    ok: true,
    flows,
    runs,
    runtimeRuns,
    runtimeStatus,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => null)) as
    | (Partial<SuperAdminWhatsAppFlow> & {
        action?: "save" | "deploy";
        deployments?: Array<{ tenantId: string; agencyName: string }>;
      })
    | null;

  if (body?.action === "deploy") {
    if (!body.id || !Array.isArray(body.deployments) || !body.deployments.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Flow id and at least one deployment target are required.",
        },
        { status: 400 },
      );
    }

    const flow = await deploySuperAdminWhatsAppFlow({
      flowId: body.id,
      deployments: body.deployments,
    });

    const [flows, runs] = await Promise.all([listSuperAdminWhatsAppFlows(), listSuperAdminWhatsAppFlowRuns()]);

    return NextResponse.json({
      ok: true,
      flow,
      flows,
      runs,
    });
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
    return NextResponse.json(
      {
        ok: false,
        error: "Flow validation failed.",
        errors,
      },
      { status: 400 },
    );
  }

  const flow = await saveSuperAdminWhatsAppFlow({
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

  const [flows, runs] = await Promise.all([listSuperAdminWhatsAppFlows(), listSuperAdminWhatsAppFlowRuns()]);

  return NextResponse.json({
    ok: true,
    flow,
    flows,
    runs,
  });
}

export async function PATCH(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => null)) as { id?: string; name?: string; summary?: string } | null;
  if (!body?.id?.trim()) {
    return NextResponse.json({ ok: false, error: "Flow id is required." }, { status: 400 });
  }

  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json({ ok: false, error: "Flow name is required." }, { status: 400 });
  }

  try {
    const flow = await updateSuperAdminWhatsAppFlowMeta({
      flowId: body.id,
      name: body.name,
      summary: body.summary,
    });
    const [flows, runs] = await Promise.all([listSuperAdminWhatsAppFlows(), listSuperAdminWhatsAppFlowRuns()]);

    return NextResponse.json({
      ok: true,
      flow,
      flows,
      runs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Flow update failed.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id?.trim()) {
    return NextResponse.json({ ok: false, error: "Flow id is required." }, { status: 400 });
  }

  try {
    const flow = await deleteSuperAdminWhatsAppFlow(body.id);
    const [flows, runs] = await Promise.all([listSuperAdminWhatsAppFlows(), listSuperAdminWhatsAppFlowRuns()]);

    return NextResponse.json({
      ok: true,
      flow,
      flows,
      runs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Flow delete failed.",
      },
      { status: 400 },
    );
  }
}
