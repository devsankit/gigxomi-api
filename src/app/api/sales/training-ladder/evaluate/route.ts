import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { evaluateSalesAgentLevel } from "@/lib/gigxomi/sales-operating-system-store";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const sales = await getSalesSnapshotForRole(authorization.session);
  const currentAgent = sales.currentAgent ?? sales.agents.find((agent) => agent.userId === String(body?.userId ?? ""));
  const targetUserId = authorization.session.role === "SUPER_ADMIN" ? String(body?.userId ?? currentAgent?.userId ?? authorization.session.userId) : authorization.session.userId;
  const targetAgentId = authorization.session.role === "SUPER_ADMIN" ? currentAgent?.id ?? null : sales.currentAgent?.id ?? null;

  const agentLevel = await evaluateSalesAgentLevel({
    userId: targetUserId,
    agentId: targetAgentId,
    override:
      authorization.session.role === "SUPER_ADMIN" && body
        ? {
            currentLevel: typeof body.currentLevel === "string" && body.currentLevel ? body.currentLevel : undefined,
            currentStep: typeof body.currentStep === "string" && body.currentStep ? body.currentStep : undefined,
            leadsUnlocked: Number.isFinite(Number(body.leadsUnlocked)) ? Number(body.leadsUnlocked) : undefined,
            managerPathUnlocked: typeof body.managerPathUnlocked === "boolean" ? body.managerPathUnlocked : undefined,
            teamCreationUnlocked: typeof body.teamCreationUnlocked === "boolean" ? body.teamCreationUnlocked : undefined,
            overrideNote: typeof body.overrideNote === "string" ? body.overrideNote : undefined,
          }
        : undefined,
  });

  return NextResponse.json({ ok: true, agentLevel });
}
