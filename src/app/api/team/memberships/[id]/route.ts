import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { cancelTeamRequest, respondToTeamRequest } from "@/lib/gigxomi/app-team-flow-service";
import { prisma } from "@/lib/prisma";

const AGENCY_STATUSES = new Set(["ACTIVE", "SUSPENDED", "REMOVED", "DECLINED"]);
const FREELANCER_STATUSES = new Set(["ACTIVE", "DECLINED"]);

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) return authorization.response;

  const { id } = await context.params;
  const result = await cancelTeamRequest(authorization.session, id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, request: result.request });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const status = body?.status ? String(body.status).toUpperCase() : "";
  const isFreelancer = authorization.session.role === "FREELANCER";
  const allowedStatuses = isFreelancer ? FREELANCER_STATUSES : AGENCY_STATUSES;
  if (status && !allowedStatuses.has(status)) {
    return NextResponse.json({ ok: false, error: "Unsupported team membership action." }, { status: 400 });
  }

  const rawPermissions: unknown[] | null = Array.isArray(body?.permissions) ? body.permissions : null;
  const permissions: string[] | undefined = rawPermissions
    ? Array.from(new Set(rawPermissions.map((p: unknown) => String(p).trim()).filter(Boolean)))
    : undefined;

  if (!status && permissions === undefined) {
    return NextResponse.json({ ok: false, error: "Status or permissions payload required." }, { status: 400 });
  }

  const pendingRequest = await prisma.appTeamRequest.findUnique({ where: { id } });
  if (pendingRequest && ["SENT", "PENDING"].includes(pendingRequest.status)) {
    if (status === "DECLINED" || status === "REMOVED") {
      const cancelResult = await cancelTeamRequest(authorization.session, id);
      if (!cancelResult.ok) return NextResponse.json({ ok: false, error: cancelResult.error }, { status: cancelResult.status });
      return NextResponse.json({ ok: true, request: cancelResult.request });
    }
    const result = await respondToTeamRequest(authorization.session, id, {
      action: status === "ACTIVE" ? "ACCEPT" : "REJECT",
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, membership: result.membership, request: result.request });
  }

  const membership = await prisma.appTeamMembership.findUnique({ where: { id } });
  if (!membership) {
    return NextResponse.json({ ok: false, error: "Team membership not found." }, { status: 404 });
  }

  if (isFreelancer) {
    if (membership.freelancerId !== authorization.session.userId) {
      return NextResponse.json({ ok: false, error: "You cannot update this agency membership." }, { status: 403 });
    }
  } else if (authorization.session.role !== "SUPER_ADMIN" && membership.tenantId !== resolveSessionTenantId(authorization.session)) {
    return NextResponse.json({ ok: false, error: "You cannot update another agency's team." }, { status: 403 });
  }

  const normalizedStatus = status ? (status === "DECLINED" ? "REMOVED" : status) : undefined;
  const updated = await prisma.appTeamMembership.update({
    where: { id },
    data: {
      ...(normalizedStatus ? { status: normalizedStatus, removedAt: normalizedStatus === "REMOVED" ? new Date() : null } : {}),
      ...(permissions !== undefined && !isFreelancer ? { permissions } : {}),
    },
  });
  return NextResponse.json({ ok: true, membership: updated });
}
