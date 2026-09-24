import "server-only";

import { createSessionPayload } from "@/lib/auth/session";
import { toMobileSession } from "@/lib/auth/mobile-session";
import { createSessionToken } from "@/lib/auth/token";
import type { ManagedAuthUser } from "@/lib/auth/types";

export async function createConnectedMobileAuthPayload(user: ManagedAuthUser) {
  const session = createSessionPayload({
    userId: user.id,
    role: user.role,
    assignedRole: user.assignedRole,
    tenantId: user.tenantId,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    packageId: user.packageId,
    packageName: user.packageName,
    packageAudience: user.packageAudience,
    packageStatus: user.packageStatus,
    packageExpiresAt: user.packageExpiresAt,
    workspaceMode: user.workspaceMode,
  });
  return { token: await createSessionToken(session), session: toMobileSession(session) };
}
