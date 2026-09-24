import type { SessionContext, UserRole } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/types";

export const DEFAULT_TENANT_ID = "tenant-agency-408de269";

type TenantScopedSession = Pick<SessionUser, "role" | "tenantId"> | Pick<SessionContext, "role" | "tenantId">;
type WhatsAppTenantScopedSession = TenantScopedSession & { userId?: string | null };

function normalizeTenantId(value?: string | null) {
  const tenantId = value?.trim();
  if (!tenantId || tenantId === "tenant-gigxomi") {
    return null;
  }
  return tenantId;
}

function canOverrideTenant(role: UserRole) {
  return role === "SUPER_ADMIN";
}

export function resolveSessionTenantId(session: TenantScopedSession, explicitTenantId?: string | null) {
  const requestedTenantId = normalizeTenantId(explicitTenantId);

  if (requestedTenantId) {
    if (canOverrideTenant(session.role)) {
      return requestedTenantId;
    }

    const sessionTenantId = normalizeTenantId(session.tenantId);
    if (sessionTenantId === requestedTenantId) {
      return sessionTenantId;
    }
  }

  return normalizeTenantId(session.tenantId) ?? DEFAULT_TENANT_ID;
}

export function buildSalesWhatsAppTenantId(userId: string) {
  return `tenant-gigxomi-sales-agent-${userId.trim()}`;
}

export function resolveWhatsAppSetupTenantId(session: WhatsAppTenantScopedSession, explicitTenantId?: string | null) {
  if (session.role === "SALES_AGENT" && session.userId?.trim()) {
    return buildSalesWhatsAppTenantId(session.userId);
  }

  return resolveSessionTenantId(session, explicitTenantId);
}
