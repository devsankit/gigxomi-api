import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";

import { createSessionToken, verifySessionToken } from "@/lib/auth/token";
import { repairAgencyTenantIsolation } from "@/lib/auth/store";
import type { AppRole, PackageAudience, PackageStatus, SessionUser, WorkspaceMode } from "@/lib/auth/types";

export type UserRole = AppRole | "GUEST";

export type SessionContext = {
  userId: string | null;
  role: UserRole;
  assignedRole: AppRole | null;
  tenantId: string | null;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  packageId: string | null;
  packageName: string | null;
  packageAudience: "FREELANCER" | "AGENCY" | null;
  packageStatus: "ACTIVE" | "PAUSED" | "EXPIRED" | null;
  packageExpiresAt: string | null;
  workspaceMode: "AGENCY" | "FREELANCER" | null;
  sessionId: string | null;
  expiresAt: number | null;
};

export const SESSION_COOKIE_NAME = "gx_session";
export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * SESSION_TTL_DAYS;
const DEFAULT_TENANT_ID = "tenant-agency-408de269";

type DashboardIdentity = {
  role: UserRole;
  packageAudience?: PackageAudience | null;
  workspaceMode?: WorkspaceMode;
};

type SessionInput = Omit<SessionUser, "sessionId" | "expiresAt" | "packageExpiresAt"> & {
  sessionId?: string;
  expiresAt?: number;
  packageExpiresAt?: string | null;
};

function derivePackageStatus(packageId: string | null, packageStatus: PackageStatus, packageExpiresAt: string | null): PackageStatus {
  if (packageExpiresAt) {
    const expiresAt = new Date(packageExpiresAt).getTime();
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      return "EXPIRED";
    }
  }

  if (packageStatus === "PAUSED") {
    return "PAUSED";
  }

  if (packageStatus === "ACTIVE") {
    return "ACTIVE";
  }

  return packageId ? "ACTIVE" : null;
}

function resolveSessionRole(
  role: AppRole,
  assignedRole: AppRole,
  packageAudience: PackageAudience | null,
  _packageStatus: PackageStatus,
  workspaceMode: WorkspaceMode,
): { role: AppRole; workspaceMode: WorkspaceMode } {
  if (packageAudience === "AGENCY") {
    return {
      role: assignedRole === "MANAGER" ? "MANAGER" as const : "ADMIN" as const,
      workspaceMode: "AGENCY" as const,
    };
  }

  if (packageAudience === "FREELANCER") {
    return {
      role: "FREELANCER" as const,
      workspaceMode: "FREELANCER" as const,
    };
  }

  return {
    role,
    workspaceMode,
  };
}

export function getDefaultDashboardPath(role: UserRole) {
  switch (role) {
    case "SUPER_ADMIN":
      return "/super-admin";
    case "ADMIN":
      return "/admin/chat";
    case "MANAGER":
      return "/manager/chat";
    case "SALES_AGENT":
      return "/sales";
    case "FREELANCER":
      return "/freelancer/chat";
    default:
      return "/login";
  }
}

export function getDashboardPathForIdentity(identity: DashboardIdentity) {
  if (identity.role === "SUPER_ADMIN") {
    return "/super-admin";
  }

  if (identity.role === "MANAGER") {
    return "/manager/chat";
  }

  if (identity.role === "SALES_AGENT") {
    return "/sales";
  }

  if (identity.role === "FREELANCER") {
    return "/freelancer/chat";
  }

  if (identity.packageAudience === "AGENCY" || identity.workspaceMode === "AGENCY" || identity.role === "ADMIN") {
    return "/admin/chat";
  }

  return getDefaultDashboardPath(identity.role);
}

export function getSafeRedirectPath(value: string | null | undefined, role: UserRole) {
  const fallback = getDashboardPathForIdentity({ role });
  if (!value?.trim()) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  const normalized = value.split("?")[0].toLowerCase();
  if (
    normalized === "/login" ||
    normalized === "/manager-login" ||
    normalized === "/verify-otp" ||
    normalized === "/subscription-required" ||
    normalized === "/signup"
  ) {
    return fallback;
  }

  if (role === "GUEST") {
    return "/login";
  }

  if (value.startsWith("/admin") && role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return fallback;
  }

  if (value.startsWith("/manager") && role !== "MANAGER" && role !== "SUPER_ADMIN") {
    return fallback;
  }

  if (value.startsWith("/freelancer") && role !== "FREELANCER" && role !== "SUPER_ADMIN") {
    return fallback;
  }

  if (value.startsWith("/super-admin") && role !== "SUPER_ADMIN") {
    return fallback;
  }

  return value;
}

export function roleLabel(role: UserRole) {
  switch (role) {
    case "SUPER_ADMIN":
      return "Super Admin";
    case "ADMIN":
      return "Admin";
    case "MANAGER":
      return "Manager";
    case "SALES_AGENT":
      return "Sales Agent";
    case "FREELANCER":
      return "Freelancer";
    default:
      return "Guest";
  }
}

function readBearerToken(value: string | null) {
  if (!value) {
    return null;
  }

  const [scheme, ...tokenParts] = value.trim().split(/\s+/);
  const token = tokenParts.join(" ");

  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

async function getBearerSessionToken() {
  const incomingHeaders = await headers();
  return readBearerToken(incomingHeaders.get("authorization"));
}

export function createSessionPayload(session: SessionInput): SessionUser {
  return {
    ...session,
    packageExpiresAt: session.packageExpiresAt ?? null,
    sessionId: session.sessionId ?? crypto.randomUUID(),
    expiresAt: session.expiresAt ?? Date.now() + SESSION_TTL_MS,
  };
}

export async function getSessionContext(): Promise<SessionContext> {
  const store = await cookies();
  const legacyRole = store.get("gx_role")?.value ?? "GUEST";
  const legacyTenantId = store.get("gx_tenant")?.value ?? null;
  const token = (await getBearerSessionToken()) ?? store.get(SESSION_COOKIE_NAME)?.value ?? null;
  const verified = await verifySessionToken(token);

  if (verified) {
    const repairedAgencyUser =
      verified.packageAudience === "AGENCY" && verified.tenantId === DEFAULT_TENANT_ID
        ? await repairAgencyTenantIsolation(verified.userId).catch(() => null)
        : null;
    const effectiveUser = repairedAgencyUser
      ? {
          ...verified,
          role: repairedAgencyUser.role,
          assignedRole: repairedAgencyUser.assignedRole,
          tenantId: repairedAgencyUser.tenantId,
          displayName: repairedAgencyUser.displayName,
          email: repairedAgencyUser.email,
          phone: repairedAgencyUser.phone,
          packageId: repairedAgencyUser.packageId,
          packageName: repairedAgencyUser.packageName,
          packageAudience: repairedAgencyUser.packageAudience,
          packageStatus: repairedAgencyUser.packageStatus,
          packageExpiresAt: repairedAgencyUser.packageExpiresAt,
          workspaceMode: repairedAgencyUser.workspaceMode,
        }
      : verified;
    const packageStatus = derivePackageStatus(effectiveUser.packageId ?? null, effectiveUser.packageStatus ?? null, effectiveUser.packageExpiresAt ?? null);
    const resolved = resolveSessionRole(
      effectiveUser.role,
      effectiveUser.assignedRole ?? effectiveUser.role,
      effectiveUser.packageAudience ?? null,
      packageStatus,
      effectiveUser.workspaceMode ?? null,
    );

    return {
      userId: effectiveUser.userId,
      role: resolved.role,
      assignedRole: effectiveUser.assignedRole ?? effectiveUser.role,
      tenantId: effectiveUser.tenantId,
      displayName: effectiveUser.displayName,
      email: effectiveUser.email,
      phone: effectiveUser.phone,
      packageId: effectiveUser.packageId,
      packageName: effectiveUser.packageName,
      packageAudience: effectiveUser.packageAudience,
      packageStatus,
      packageExpiresAt: effectiveUser.packageExpiresAt,
      workspaceMode: resolved.workspaceMode,
      sessionId: effectiveUser.sessionId,
      expiresAt: effectiveUser.expiresAt,
    };
  }

  return {
    userId: null,
    role: "GUEST",
    assignedRole: null,
    tenantId: legacyTenantId,
    displayName: null,
    email: null,
    phone: null,
    packageId: null,
    packageName: null,
    packageAudience: null,
    packageStatus: null,
    packageExpiresAt: null,
    workspaceMode: null,
    sessionId: null,
    expiresAt: null,
  };
}

export async function applySessionCookie(response: NextResponse, session: SessionInput) {
  const payload = createSessionPayload(session);
  const token = await createSessionToken(payload);
  const expires = new Date(payload.expiresAt);
  const maxAge = Math.max(0, Math.ceil((payload.expiresAt - Date.now()) / 1000));

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires,
    maxAge,
  });
  response.cookies.set("gx_role", payload.role, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires,
    maxAge,
  });
  if (payload.tenantId) {
    response.cookies.set("gx_tenant", payload.tenantId, {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires,
      maxAge,
    });
  } else {
    response.cookies.set("gx_tenant", "", { path: "/", maxAge: 0 });
  }
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  response.cookies.set("gx_role", "", { path: "/", maxAge: 0 });
  response.cookies.set("gx_tenant", "", { path: "/", maxAge: 0 });
}
