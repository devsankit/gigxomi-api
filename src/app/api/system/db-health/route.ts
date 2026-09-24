import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getDatabaseHealth } from "@/lib/system/db-health";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const health = await getDatabaseHealth();
  return NextResponse.json(
    {
      ok: health.ok,
      health,
    },
    { status: health.ok ? 200 : 503 },
  );
}
