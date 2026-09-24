import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { createTeamRequest, listTenantTeamRequests } from "@/lib/gigxomi/app-team-flow-service";

export async function GET(_: Request, context: { params: Promise<{ tenantId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { tenantId } = await context.params;
  const result = await listTenantTeamRequests(authorization.session, tenantId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    requests: result.requests,
    memberships: result.memberships,
  });
}

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { tenantId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await createTeamRequest(authorization.session, tenantId, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    request: result.request,
    duplicate: result.duplicate,
  });
}
