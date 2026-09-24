import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { buildSuperAdminOverviewData } from "@/lib/gigxomi/dashboard-overview-data";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const payload = await buildSuperAdminOverviewData();
  return NextResponse.json({
    ok: true,
    ...payload,
  });
}
