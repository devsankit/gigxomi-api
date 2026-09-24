import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/session";
import type { AppRole, SessionUser } from "@/lib/auth/types";

type PublishingAuthorizedSession = Omit<SessionUser, "displayName" | "phone"> & {
  displayName: string;
  phone: string | null;
};

type PublishingAuthorizedResult =
  | {
      ok: true;
      session: PublishingAuthorizedSession;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requirePublishingSession(allowedRoles: AppRole[]): Promise<PublishingAuthorizedResult> {
  const session = await getSessionContext();

  if (session.role === "GUEST" || !session.userId || !session.sessionId || !session.expiresAt) {
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

  return {
    ok: true,
    session: {
      userId: session.userId,
      role: session.role,
      assignedRole: session.assignedRole ?? session.role,
      tenantId: session.tenantId,
      displayName: session.displayName?.trim() || session.email?.trim() || session.phone?.trim() || "Gigxomi user",
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
