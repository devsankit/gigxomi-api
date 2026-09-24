import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listRecentPublicAuthIntents } from "@/lib/auth/public-auth-intent-store";

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { searchParams } = new URL(request.url);
  const limit = Number.parseInt(searchParams.get("limit") ?? "10", 10);
  const intents = await listRecentPublicAuthIntents(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 10);

  return NextResponse.json({
    ok: true,
    intents,
  });
}
