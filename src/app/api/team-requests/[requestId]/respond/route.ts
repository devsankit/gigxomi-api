import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { respondToTeamRequest } from "@/lib/gigxomi/app-team-flow-service";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { requestId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await respondToTeamRequest(authorization.session, requestId, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    request: result.request,
    membership: result.membership,
  });
}
