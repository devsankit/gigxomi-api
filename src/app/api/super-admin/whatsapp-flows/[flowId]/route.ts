import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  deleteSuperAdminWhatsAppFlow,
  getSuperAdminWhatsAppFlow,
  listSuperAdminWhatsAppFlowRuns,
  listSuperAdminWhatsAppFlows,
  updateSuperAdminWhatsAppFlowMeta,
} from "@/lib/gigxomi/super-admin-whatsapp-flow-store";

type RouteContext = {
  params: Promise<{ flowId: string }>;
};

async function flowSnapshotResponse(flowId: string) {
  const flow = await getSuperAdminWhatsAppFlow(flowId);
  if (!flow) {
    return NextResponse.json({ ok: false, error: "Flow not found." }, { status: 404 });
  }

  const [flows, runs] = await Promise.all([listSuperAdminWhatsAppFlows(), listSuperAdminWhatsAppFlowRuns()]);
  return NextResponse.json({
    ok: true,
    flow,
    flows,
    runs,
  });
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { flowId } = await context.params;
  return flowSnapshotResponse(flowId);
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { flowId } = await context.params;
  const body = (await request.json().catch(() => null)) as { name?: string; summary?: string } | null;
  if (body?.name !== undefined && !body.name.trim()) {
    return NextResponse.json({ ok: false, error: "Flow name is required." }, { status: 400 });
  }

  try {
    const flow = await updateSuperAdminWhatsAppFlowMeta({
      flowId,
      name: body?.name,
      summary: body?.summary,
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

export async function DELETE(_request: Request, context: RouteContext) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { flowId } = await context.params;
  try {
    const flow = await deleteSuperAdminWhatsAppFlow(flowId);
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
