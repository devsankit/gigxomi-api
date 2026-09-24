import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { sendStandaloneWhatsAppMessageFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json().catch(() => null);
  const tenantId = resolveSessionTenantId(authorization.session, body?.tenantId);

  if (!body?.to || !body?.body) {
    return NextResponse.json(
      {
        ok: false,
        error: "Recipient number and message body are required.",
      },
      { status: 400 },
    );
  }

  const result = await sendStandaloneWhatsAppMessageFromFile({
    tenantId,
    to: String(body.to),
    body: String(body.body),
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.mode === "local-only" ? 200 : 502,
  });
}
