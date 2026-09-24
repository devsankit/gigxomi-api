import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { createInternalUser, getManagedAuthUsers } from "@/lib/auth/store";
import type { AppRole, PackageStatus } from "@/lib/auth/types";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const users = await getManagedAuthUsers();

  return NextResponse.json({
    ok: true,
    users,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => null)) as
    | {
        role?: AppRole;
        displayName?: string;
        email?: string;
        phone?: string;
        password?: string;
        packageId?: string | null;
        packageStatus?: PackageStatus;
        packageExpiresAt?: string | null;
        tenantId?: string | null;
      }
    | null;

  if (!body) {
    return NextResponse.json({ ok: false, error: "User payload is required." }, { status: 400 });
  }

  if (body.role === "SUPER_ADMIN") {
    return NextResponse.json(
      { ok: false, error: "Super admin is locked to the canonical owner identity and cannot be created here." },
      { status: 400 },
    );
  }

  const result = await createInternalUser({
    role: body.role ?? "FREELANCER",
    displayName: body.displayName ?? "",
    email: body.email ?? "",
    phone: body.phone ?? "",
    password: body.password ?? "",
    packageId: body.packageId ?? null,
    packageStatus:
      body.packageStatus === "ACTIVE" || body.packageStatus === "PAUSED" || body.packageStatus === "EXPIRED"
        ? body.packageStatus
        : undefined,
    packageExpiresAt: body.packageExpiresAt ?? null,
    tenantId: body.tenantId ?? undefined,
    createdByUserId: authorization.session.userId,
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
