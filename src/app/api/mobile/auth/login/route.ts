import { NextResponse } from "next/server";

import { toMobileSession } from "@/lib/auth/mobile-session";
import { createSessionPayload } from "@/lib/auth/session";
import { authenticatePassword } from "@/lib/auth/store";
import { createSessionToken } from "@/lib/auth/token";

type MobileLoginBody = {
  identifier?: unknown;
  email?: unknown;
  password?: unknown;
  loginScope?: unknown;
  role?: unknown;
};

function readBodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  let body: MobileLoginBody;

  try {
    body = (await request.json()) as MobileLoginBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Send a valid JSON login body." }, { status: 400 });
  }

  const identifier = (readBodyString(body.identifier) || readBodyString(body.email)).trim();
  const password = readBodyString(body.password);
  const rawScope = (readBodyString(body.loginScope) || readBodyString(body.role)).trim().toLowerCase();
  const requireManager = rawScope === "manager";
  const requireSales = rawScope === "sales" || rawScope === "sales_agent";

  if (!identifier || !password) {
    return NextResponse.json({ ok: false, error: "Email or phone and password are required." }, { status: 400 });
  }

  const user = await authenticatePassword(identifier, password);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Invalid login details." }, { status: 401 });
  }
  if (requireManager && user.role !== "MANAGER") {
    return NextResponse.json({ ok: false, error: "This login is only for manager accounts." }, { status: 403 });
  }
  if (requireSales && user.role !== "SALES_AGENT") {
    return NextResponse.json({ ok: false, error: "This login is only for active Gigxomi sales accounts." }, { status: 403 });
  }

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
  const token = await createSessionToken(session);

  return NextResponse.json({
    ok: true,
    token,
    session: toMobileSession(session),
  });
}
