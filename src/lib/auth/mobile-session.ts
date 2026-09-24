import type { SessionUser } from "@/lib/auth/types";

export type MobileSession = {
  userId: string;
  role: SessionUser["role"];
  assignedRole: SessionUser["assignedRole"];
  tenantId: string | null;
  displayName: string;
  email: string | null;
  phone: string;
  packageId: string | null;
  packageName: string | null;
  packageAudience: SessionUser["packageAudience"];
  packageStatus: SessionUser["packageStatus"];
  packageExpiresAt: string | null;
  workspaceMode: SessionUser["workspaceMode"];
  expiresAt: number;
};

export function toMobileSession(session: SessionUser): MobileSession {
  return {
    userId: session.userId,
    role: session.role,
    assignedRole: session.assignedRole,
    tenantId: session.tenantId,
    displayName: session.displayName,
    email: session.email,
    phone: session.phone,
    packageId: session.packageId,
    packageName: session.packageName,
    packageAudience: session.packageAudience,
    packageStatus: session.packageStatus,
    packageExpiresAt: session.packageExpiresAt,
    workspaceMode: session.workspaceMode,
    expiresAt: session.expiresAt,
  };
}
