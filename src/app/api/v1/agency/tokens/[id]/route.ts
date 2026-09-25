import { NextResponse } from "next/server";

import { revokeAgencyToken } from "@/lib/api/agency-api-token-service";
import { getSessionContext } from "@/lib/auth/session";
import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
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

  const { id } = await props.params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Token ID required" }, { status: 400 });
  }

  try {
    const result = await revokeAgencyToken(id, tenantId);
    return NextResponse.json({ ok: result.ok });
  } catch (error) {
    console.error("[AgencyTokensApi] Error revoking token:", error);
    return NextResponse.json({ ok: false, error: "Failed to revoke token" }, { status: 500 });
  }
}
