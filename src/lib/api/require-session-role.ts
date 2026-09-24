import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/session";
import type { AppRole, SessionUser } from "@/lib/auth/types";
import { getSalesAgentAccess } from "@/lib/gigxomi/sales-store";

type AuthorizedSession = Omit<SessionUser, "expiresAt" | "sessionId"> & Pick<SessionUser, "expiresAt" | "sessionId">;

type AuthorizedResult =
  | {
      ok: true;
      session: AuthorizedSession;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requireSessionRole(allowedRoles: AppRole[]): Promise<AuthorizedResult> {
  const session = await getSessionContext();

  if (session.role === "GUEST" || !session.userId || !session.displayName || !session.phone || !session.sessionId || !session.expiresAt) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 }),
    };
  }

  if (!allowedRoles.includes(session.role)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "You do not have access to this action." }, { status: 403 }),
    };
  }

  if (session.role === "SALES_AGENT") {
    const access = await getSalesAgentAccess(session.userId);
    if (!access.ok) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: "Your sales account is not active." }, { status: 403 }),
      };
    }
  }

  return {
    ok: true,
    session: {
      userId: session.userId,
      role: session.role,
      assignedRole: session.assignedRole ?? session.role,
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
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    },
  };
}
