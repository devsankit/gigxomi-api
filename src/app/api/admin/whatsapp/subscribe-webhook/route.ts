import { NextResponse } from "next/server";

import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { getWhatsAppConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { subscribeWhatsAppWebhookWithRediscovery } from "@/lib/gigxomi/whatsapp-onboarding-subscribe";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json().catch(() => null);
  const tenantId = resolveWhatsAppSetupTenantId(authorization.session, body?.tenantId);
  const connection = await getWhatsAppConnectionStateFromFile(tenantId);
  if (!connection) {
    return NextResponse.json({ ok: false, error: "WhatsApp setup is not available for this tenant yet." }, { status: 404 });
  }

  const result = await subscribeWhatsAppWebhookWithRediscovery({
    tenantId,
    connection,
    successNote: "Webhook app subscription confirmed. Meta should now deliver inbound message webhooks to Gigxomi.",
    failureNote: "WhatsApp line is saved, but webhook app subscription still needs attention. Review token permissions and the WABA that owns this phone number.",
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        retriedWithDiscoveredWaba: result.retriedWithDiscoveredWaba,
        connection: result.connection,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    tenantId,
    retriedWithDiscoveredWaba: result.retriedWithDiscoveredWaba,
    connection: result.connection,
  });
}
