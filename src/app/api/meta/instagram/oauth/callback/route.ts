import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPublicRequestUrl } from "@/lib/auth/request-url";
import { getSessionContext } from "@/lib/auth/session";
import { exchangeInstagramOAuthCodeFromFile, getInstagramConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { buildInstagramMetaSetupUrls } from "@/lib/meta/instagram-routes";

const INSTAGRAM_OAUTH_STATE_COOKIE = "gx_instagram_oauth_state";

function getInstagramOAuthRedirectUri(request: Request) {
  const configuredRedirectUri =
    process.env.INSTAGRAM_OAUTH_REDIRECT_URI?.trim() ||
    process.env.NEXT_PUBLIC_INSTAGRAM_OAUTH_REDIRECT_URI?.trim();

  return configuredRedirectUri || buildInstagramMetaSetupUrls(getPublicRequestUrl(request, "/").origin).oauthRedirectUri;
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(INSTAGRAM_OAUTH_STATE_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
  return response;
}

function buildSetupRedirect(request: Request, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  return getPublicRequestUrl(request, `/admin/integrations/instagram?${query.toString()}`);
}

export async function GET(request: Request) {
  const session = await getSessionContext();
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return clearStateCookie(
      NextResponse.redirect(
        getPublicRequestUrl(request, `/login?error=${encodeURIComponent("Admin login expired before the Instagram callback completed.")}`),
      ),
    );
  }

  const requestUrl = new URL(request.url);
  const error = requestUrl.searchParams.get("error");
  const errorMessage = requestUrl.searchParams.get("error_description") || requestUrl.searchParams.get("message") || error;
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const store = await cookies();
  const savedState = store.get(INSTAGRAM_OAUTH_STATE_COOKIE)?.value ?? "";
  const separator = savedState.indexOf(".");
  const expectedState = separator >= 0 ? savedState.slice(0, separator) : "";
  let tenantId = "";
  try {
    tenantId = separator >= 0 ? decodeURIComponent(savedState.slice(separator + 1)) : "";
  } catch {
    tenantId = "";
  }

  if (error) {
    return clearStateCookie(
      NextResponse.redirect(buildSetupRedirect(request, { instagramError: `Instagram connection failed: ${errorMessage}` })),
    );
  }

  if (!code) {
    return clearStateCookie(
      NextResponse.redirect(buildSetupRedirect(request, { instagramError: "Instagram did not return an authorization code." })),
    );
  }

  if (!expectedState || !tenantId || state !== expectedState || (session.role !== "SUPER_ADMIN" && session.tenantId !== tenantId)) {
    return clearStateCookie(
      NextResponse.redirect(buildSetupRedirect(request, { instagramError: "Instagram OAuth state did not match. Start the connection flow again." })),
    );
  }

  const connection = await getInstagramConnectionStateFromFile(tenantId);
  if (!connection?.pluginEnabled) {
    return clearStateCookie(
      NextResponse.redirect(buildSetupRedirect(request, { instagramError: "Enable the Instagram Inbox plugin before completing Instagram permissions." })),
    );
  }

  try {
    const redirectUri = getInstagramOAuthRedirectUri(request);
    const cleanCode = code.replace(/#_.*$/, "").trim();
    await exchangeInstagramOAuthCodeFromFile({ code: cleanCode, redirectUri, tenantId });
    return clearStateCookie(
      NextResponse.redirect(buildSetupRedirect(request, { instagramConnected: "1" })),
    );
  } catch (callbackError) {
    const message = callbackError instanceof Error ? callbackError.message : "Unable to complete Instagram connection.";
    return clearStateCookie(
      NextResponse.redirect(buildSetupRedirect(request, { instagramError: message })),
    );
  }
}
