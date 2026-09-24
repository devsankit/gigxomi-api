import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { deleteManagedAuthUser, getManagedAuthUsers, updateManagedAuthUserAccess } from "@/lib/auth/store";
import type { PackageStatus } from "@/lib/auth/types";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        packageId?: string | null;
        packageStatus?: PackageStatus;
        packageExpiresAt?: string | null;
      }
    | null;

  if (!body) {
    return NextResponse.json({ ok: false, error: "Update payload is required." }, { status: 400 });
  }

  const nextStatus =
    body.packageStatus === "ACTIVE" || body.packageStatus === "PAUSED" || body.packageStatus === "EXPIRED"
      ? body.packageStatus
      : undefined;

  const result = await updateManagedAuthUserAccess({
    userId: id,
    packageId: body.packageId,
    packageStatus: nextStatus,
    packageExpiresAt: body.packageExpiresAt,
    updatedByUserId: authorization.session.userId,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    user: result.user,
    users: await getManagedAuthUsers(),
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const result = await deleteManagedAuthUser({
    userId: id,
    deletedByUserId: authorization.session.userId,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    deletedUserId: result.deletedUserId,
    users: await getManagedAuthUsers(),
  });
}
