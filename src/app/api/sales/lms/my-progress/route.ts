import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesOperatingSnapshot } from "@/lib/gigxomi/sales-operating-system-store";

export async function GET() {
  const authorization = await requireSessionRole(["SALES_AGENT", "SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const snapshot = await getSalesOperatingSnapshot(authorization.session);
  return NextResponse.json({ ok: true, progress: snapshot.progress, agentLevel: snapshot.agentLevel, unlockRules: snapshot.unlockRules });
}
