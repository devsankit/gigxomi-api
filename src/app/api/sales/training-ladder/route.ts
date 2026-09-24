import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesOperatingSnapshot, salesTrainingSteps } from "@/lib/gigxomi/sales-operating-system-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const snapshot = await getSalesOperatingSnapshot(authorization.session);
  return NextResponse.json({
    ok: true,
    steps: salesTrainingSteps,
    unlockRules: snapshot.unlockRules,
    agentLevel: snapshot.agentLevel,
    progress: snapshot.progress,
    mockCalls: snapshot.mockCalls,
  });
}
