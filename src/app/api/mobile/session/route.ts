import { NextResponse } from "next/server";

import { rejectMissingMobileSessionUser } from "@/lib/api/mobile-session-user";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { toMobileSession } from "@/lib/auth/mobile-session";
import { createSessionPayload } from "@/lib/auth/session";
import { getManagedUserForSession } from "@/lib/billing/subscription-service";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const staleSessionResponse = await rejectMissingMobileSessionUser(authorization.session.userId);
  if (staleSessionResponse) {
    return staleSessionResponse;
  }

  try {
    const dbUser = await getManagedUserForSession(authorization.session.userId);
    const freshSession = createSessionPayload({
      userId: dbUser.id,
      role: dbUser.role,
      assignedRole: dbUser.assignedRole,
      tenantId: dbUser.tenantId,
      displayName: dbUser.displayName,
      email: dbUser.email,
      phone: dbUser.phone,
      packageId: dbUser.packageId,
      packageName: dbUser.packageName,
      packageAudience: dbUser.packageAudience,
      packageStatus: dbUser.packageStatus,
      packageExpiresAt: dbUser.packageExpiresAt,
      workspaceMode: dbUser.workspaceMode,
    });

    return NextResponse.json({
      ok: true,
      session: toMobileSession(freshSession),
    });
  } catch {
    return NextResponse.json({
      ok: true,
      session: toMobileSession(authorization.session),
    });
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";

  if (!displayName) {
    return NextResponse.json({ ok: false, error: "Name cannot be empty." }, { status: 400 });
  }

  const { prisma } = await import("@/lib/prisma");

  await prisma.appAuthUser.update({
    where: { id: authorization.session.userId },
    data: { displayName },
  });

  if (authorization.session.tenantId && authorization.session.role === "ADMIN") {
    const { updateAgencyListingNameFromFile } = await import("@/lib/gigxomi/agency-listing-store");
    await updateAgencyListingNameFromFile(authorization.session.tenantId, displayName).catch(() => null);
  }

  try {
    const dbUser = await getManagedUserForSession(authorization.session.userId);
    const freshSession = createSessionPayload({
      userId: dbUser.id,
      role: dbUser.role,
      assignedRole: dbUser.assignedRole,
      tenantId: dbUser.tenantId,
      displayName: dbUser.displayName,
      email: dbUser.email,
      phone: dbUser.phone,
      packageId: dbUser.packageId,
      packageName: dbUser.packageName,
      packageAudience: dbUser.packageAudience,
      packageStatus: dbUser.packageStatus,
      packageExpiresAt: dbUser.packageExpiresAt,
      workspaceMode: dbUser.workspaceMode,
    });

    return NextResponse.json({
      ok: true,
      session: toMobileSession(freshSession),
    });
  } catch {
    return NextResponse.json({
      ok: true,
      session: toMobileSession({
        ...authorization.session,
        displayName,
      }),
    });
  }
}
