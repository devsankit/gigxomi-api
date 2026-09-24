import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { applyImpersonationCookies, IMPERSONATION_TTL_MS } from "@/lib/auth/impersonation";
import { applySessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getManagedAuthUsers } from "@/lib/auth/store";
import { isManagedUserInAudience } from "@/lib/auth/managed-user-utils";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const target = (await getManagedAuthUsers()).find((user) => user.id === id);

  if (!target || target.role === "SUPER_ADMIN") {
    return NextResponse.json({ ok: false, error: "Account was not found." }, { status: 404 });
  }

  const isAgency =
    target.packageAudience === "AGENCY" &&
    target.assignedRole === "ADMIN" &&
    target.workspaceMode === "AGENCY" &&
    Boolean(target.tenantId);
  const isFreelancer = isManagedUserInAudience(target, "FREELANCER");

  if (!isAgency && !isFreelancer) {
    return NextResponse.json({ ok: false, error: "This account is not configured for workspace login." }, { status: 409 });
  }

  if (target.packageStatus !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Activate this account package before logging in." }, { status: 409 });
  }

  const cookieStore = await cookies();
  const superAdminSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!superAdminSessionToken) {
    return NextResponse.json({ ok: false, error: "Your Super Admin session could not be preserved. Please sign in again." }, { status: 401 });
  }

  const expiresAt = Date.now() + IMPERSONATION_TTL_MS;
  const targetRole = isAgency ? "ADMIN" : "FREELANCER";
  const targetAudience = isAgency ? "AGENCY" : "FREELANCER";
  const targetWorkspace = isAgency ? "AGENCY" : "FREELANCER";
  const redirectTo = isAgency ? "/admin/integrations/whatsapp" : "/freelancer";
  const returnPath = isAgency ? "/super-admin/agencies" : "/super-admin/freelancers";
  const response = NextResponse.json({
    ok: true,
    redirectTo,
  });

  await applySessionCookie(response, {
    userId: target.id,
    role: targetRole,
    assignedRole: targetRole,
    tenantId: target.tenantId,
    displayName: target.displayName,
    email: target.email || null,
    phone: target.phone,
    packageId: target.packageId,
    packageName: target.packageName,
    packageAudience: targetAudience,
    packageStatus: "ACTIVE",
    packageExpiresAt: target.packageExpiresAt,
    workspaceMode: targetWorkspace,
    expiresAt,
  });
  applyImpersonationCookies(response, {
    superAdminSessionToken,
    targetUserId: target.id,
    returnPath,
    expiresAt,
  });

  console.info("[auth] Super Admin entered a managed workspace", {
    superAdminUserId: auth.session.userId,
    targetUserId: target.id,
    targetAudience,
    tenantId: target.tenantId,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  });

  return response;
}
