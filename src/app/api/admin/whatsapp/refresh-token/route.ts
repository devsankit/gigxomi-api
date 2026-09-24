import { NextResponse } from "next/server";

import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  ensureWhatsAppConnectionStateFromFile,
  getWhatsAppConnectionStateFromFile,
  updateWhatsAppConnectionStateFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { exchangeMetaAuthorizationCode, subscribeAppToWhatsAppBusinessAccount } from "@/lib/gigxomi/meta-whatsapp-auth";

function resolveRedirectUri(publicBaseUrl: string) {
  if (!publicBaseUrl.trim()) {
    return "";
  }

  try {
    return new URL("/meta/whatsapp/callback", publicBaseUrl).toString();
  } catch {
    return "";
  }
}

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

  const refreshed = await exchangeMetaAuthorizationCode({
    appId: connection.metaAppId,
    authorizationCode: connection.authorizationCode,
    graphApiVersion: connection.graphApiVersion,
    redirectUri: resolveRedirectUri(connection.publicBaseUrl),
  });

  if (!refreshed.ok) {
    const nextConnection = await updateWhatsAppConnectionStateFromFile(tenantId, {
      lastError: refreshed.error,
      lastSignupEvent: connection.lastSignupEvent || "CODE",
      lastSignupEventAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        ok: false,
        error: refreshed.error,
        connection: nextConnection,
      },
      { status: 400 },
    );
  }

  await updateWhatsAppConnectionStateFromFile(tenantId, {
    accessToken: refreshed.accessToken,
    authorizationCode: "",
    lastError: "",
    note: refreshed.debugExpiresAt
      ? `Meta access token refreshed successfully. Token debug expiry: ${refreshed.debugExpiresAt}.`
      : "Meta access token refreshed successfully.",
  });

  const refreshedConnection = await ensureWhatsAppConnectionStateFromFile(tenantId);

  let nextConnection = refreshedConnection;
  let subscriptionError: string | null = null;

  if (refreshedConnection?.wabaId?.trim() && refreshed.accessToken.trim()) {
    const subscription = await subscribeAppToWhatsAppBusinessAccount({
      accessToken: refreshed.accessToken,
      wabaId: refreshedConnection.wabaId,
      graphApiVersion: refreshedConnection.graphApiVersion,
    });

    if (subscription.ok) {
      nextConnection = await updateWhatsAppConnectionStateFromFile(tenantId, {
        lastError: "",
        status: refreshedConnection.phoneNumberId.trim()
          ? "Ready for webhook"
          : refreshedConnection.wabaId.trim()
            ? "Number connected"
            : "Business submitted",
        note: refreshed.debugExpiresAt
          ? `Meta access token refreshed and webhook subscription confirmed. Token debug expiry: ${refreshed.debugExpiresAt}.`
          : "Meta access token refreshed and webhook subscription confirmed.",
      });
    } else {
      subscriptionError = subscription.error;
      nextConnection = await updateWhatsAppConnectionStateFromFile(tenantId, {
        lastError: subscription.error,
        note: "Meta token refreshed, but webhook app subscription still needs attention.",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tenantId,
    connection: nextConnection,
    expiresIn: refreshed.expiresIn ?? null,
    debugExpiresAt: refreshed.debugExpiresAt ?? null,
    subscriptionError,
  });
}
