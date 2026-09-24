import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { cancelTeamRequest } from "@/lib/gigxomi/app-team-flow-service";

export async function POST(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;

  const { requestId } = await context.params;
  const result = await cancelTeamRequest(authorization.session, requestId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, request: result.request });
}
