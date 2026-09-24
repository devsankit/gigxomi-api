import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { buildManagerDashboardSnapshot } from "@/lib/gigxomi/dashboard-overview-data";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const snapshot = await buildManagerDashboardSnapshot(authorization.session);
  return NextResponse.json({
    ok: true,
    snapshot,
  });
}
