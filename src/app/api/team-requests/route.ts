import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { createTeamRequest, listFreelancerTeamRequests, listTenantTeamRequests } from "@/lib/gigxomi/app-team-flow-service";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { session } = authorization;
  if (session.role === "FREELANCER") {
    const result = await listFreelancerTeamRequests(session);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      requests: result.requests,
      memberships: result.memberships,
      portfolio: result.portfolio,
    });
  }

  const tenantId = session.tenantId || "tenant-gigxomi";
  const result = await listTenantTeamRequests(session, tenantId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    requests: result.requests,
    memberships: result.memberships,
    availableFreelancers: result.availableFreelancers,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { session } = authorization;
  const tenantId = session.tenantId || "tenant-gigxomi";
  const body = await request.json().catch(() => ({}));

  const result = await createTeamRequest(session, tenantId, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    request: result.request,
    duplicate: result.duplicate,
  });
}
