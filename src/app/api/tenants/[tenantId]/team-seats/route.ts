import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listTenantTeamRequests } from "@/lib/gigxomi/app-team-flow-service";

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

  const activeMemberships = result.memberships.filter((membership) => membership.status === "ACTIVE");

  return NextResponse.json({
    ok: true,
    tenantId,
    activeSeats: activeMemberships.length,
    activeFreelancerIds: activeMemberships.map((membership) => membership.freelancerId),
    pendingRequests: result.requests.filter((request) => request.status === "PENDING" || request.status === "SENT").length,
  });
}
