import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { syncInstagramConversationsForTenant } from "@/lib/gigxomi/instagram-sync";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const body = await request.json().catch(() => ({}));
  const tenantId = resolveSessionTenantId(authorization.session, body?.tenantId);

  try {
    const result = await syncInstagramConversationsForTenant(tenantId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to sync Instagram messages." },
      { status: 500 },
    );
  }
}
