import { NextResponse } from "next/server";

import { createAgencyToken, listAgencyTokens } from "@/lib/api/agency-api-token-service";
import { getSessionContext } from "@/lib/auth/session";
import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";

export async function GET() {
  const session = await getSessionContext();
  const isAgencyOperator =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    session.role === "SUPER_ADMIN" ||
    session.packageAudience === "AGENCY" ||
    session.workspaceMode === "AGENCY";

  if (!session.userId || !isAgencyOperator) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = resolveSessionTenantId(session) || session.tenantId;
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Agency workspace not found" }, { status: 400 });
  }

  try {
    const tokens = await listAgencyTokens(tenantId);
    return NextResponse.json({ ok: true, tokens });
  } catch (error) {
    console.error("[AgencyTokensApi] Error listing tokens:", error);
    return NextResponse.json({ ok: false, error: "Failed to list tokens" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSessionContext();
  const isAgencyOperator =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    session.role === "SUPER_ADMIN" ||
    session.packageAudience === "AGENCY" ||
    session.workspaceMode === "AGENCY";

  if (!session.userId || !isAgencyOperator) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = resolveSessionTenantId(session) || session.tenantId;
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Agency workspace not found" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // defaults
  }

  const name = typeof body.name === "string" ? body.name.trim() : "Agency Studio Integration";
  const allowedOrigins = Array.isArray(body.allowedOrigins) ? body.allowedOrigins.map(String) : [];

  try {
    const result = await createAgencyToken({
      tenantId,
      name: name || "Agency Studio Integration",
      createdById: session.userId,
      scopes: ["team_portfolio:read"],
      allowedOrigins,
    });

    return NextResponse.json({
      ok: true,
      token: result.rawToken,
      record: result.record,
    });
  } catch (error) {
    console.error("[AgencyTokensApi] Error creating token:", error);
    return NextResponse.json({ ok: false, error: "Failed to generate token" }, { status: 500 });
  }
}
