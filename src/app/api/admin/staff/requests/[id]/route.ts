import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const tenantId = resolveSessionTenantId(authorization.session) || authorization.session.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Missing agency tenant context." }, { status: 400 });
  }

  const { id } = await context.params;

  const request = await prisma.appTeamRequest.findFirst({
    where: {
      id,
      tenantId,
      status: { in: ["SENT", "PENDING"] },
    },
  });

  if (!request) {
    return NextResponse.json({ ok: false, error: "Pending staff invite not found." }, { status: 404 });
  }

  await prisma.appTeamRequest.update({
    where: { id: request.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    message: "Staff invitation cancelled successfully.",
    id: request.id,
  });
}