import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { listConversationsForAudienceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const tenantId =
    authorization.session.role === "SUPER_ADMIN"
      ? undefined
      : resolveSessionTenantId(authorization.session);
  const payload = await listConversationsForAudienceFromFile("manager", { tenantId });
  return NextResponse.json({
    ok: true,
    ...payload,
  });
}
