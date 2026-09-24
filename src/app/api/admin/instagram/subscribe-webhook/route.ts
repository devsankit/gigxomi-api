import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { retryInstagramMessagingWebhookSubscriptionFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const body = await request.json().catch(() => ({}));
  const tenantId = resolveSessionTenantId(authorization.session, body?.tenantId);

  try {
    const result = await retryInstagramMessagingWebhookSubscriptionFromFile(tenantId);
    const connection = result.connection
      ? {
          username: result.connection.username,
          status: result.connection.status,
          note: result.connection.note,
          lastError: result.connection.lastError,
        }
      : null;
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, connection }, { status: 400 });
    }
    return NextResponse.json({ ok: true, connection });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unable to update the Instagram messages webhook subscription." },
      { status: 500 },
    );
  }
}
