import { NextResponse } from "next/server";

import { getPublicRequestUrl } from "@/lib/auth/request-url";
import { getSessionContext } from "@/lib/auth/session";
import { getInstagramConnectionStateFromFile, getInstagramOAuthAuthorizeUrlFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { buildInstagramMetaSetupUrls } from "@/lib/meta/instagram-routes";

const INSTAGRAM_OAUTH_STATE_COOKIE = "gx_instagram_oauth_state";

function getInstagramOAuthRedirectUri(request: Request) {
  const configuredRedirectUri =
    process.env.INSTAGRAM_OAUTH_REDIRECT_URI?.trim() ||
    process.env.NEXT_PUBLIC_INSTAGRAM_OAUTH_REDIRECT_URI?.trim();

  return configuredRedirectUri || buildInstagramMetaSetupUrls(getPublicRequestUrl(request, "/").origin).oauthRedirectUri;
}

export async function GET(request: Request) {
  const session = await getSessionContext();
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.redirect(
      getPublicRequestUrl(request, `/login?error=${encodeURIComponent("Admin login is required before connecting Instagram Inbox.")}`),
    );
  }

  const tenantId = session.tenantId ?? "tenant-gigxomi";
  const connection = await getInstagramConnectionStateFromFile(tenantId);
  if (!connection?.pluginEnabled) {
    return NextResponse.redirect(
      getPublicRequestUrl(request, `/admin/integrations?instagramError=${encodeURIComponent("Enable the Instagram Inbox plugin before connecting permissions.")}`),
    );
  }

  const state = crypto.randomUUID();
  const redirectUri = getInstagramOAuthRedirectUri(request);
  let authorizeUrl = "";
  try {
    authorizeUrl = getInstagramOAuthAuthorizeUrlFromFile({ redirectUri, state, tenantId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram OAuth is not configured correctly.";
    return NextResponse.redirect(
      getPublicRequestUrl(request, `/admin/integrations/instagram?instagramError=${encodeURIComponent(message)}`),
    );
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(INSTAGRAM_OAUTH_STATE_COOKIE, `${state}.${encodeURIComponent(tenantId)}`, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 15,
  });
  return response;
}
