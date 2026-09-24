import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPublicRequestUrl } from "@/lib/auth/request-url";
import { getSessionContext } from "@/lib/auth/session";
import { SUPER_ADMIN_LOGIN_ROUTE } from "@/lib/auth/super-admin-config";
import { exchangeYouTubeCodeForSharedConnection } from "@/lib/gigxomi/platform-youtube";

const YOUTUBE_OAUTH_STATE_COOKIE = "gx_youtube_oauth_state";

function clearStateCookie(response: NextResponse) {
  response.cookies.set(YOUTUBE_OAUTH_STATE_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const session = await getSessionContext();
  if (session.role !== "SUPER_ADMIN") {
    return clearStateCookie(
      NextResponse.redirect(
        getPublicRequestUrl(request, `${SUPER_ADMIN_LOGIN_ROUTE}?error=${encodeURIComponent("Super-admin login expired before the YouTube callback completed.")}`),
      ),
    );
  }

  const requestUrl = new URL(request.url);
  const error = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const store = await cookies();
  const savedState = store.get(YOUTUBE_OAUTH_STATE_COOKIE)?.value ?? "";

  if (error) {
    return clearStateCookie(
      NextResponse.redirect(
        getPublicRequestUrl(request, `/super-admin/platform-settings?error=${encodeURIComponent(`YouTube connection failed: ${error}`)}`),
      ),
    );
  }

  if (!code || !state || !savedState || state !== savedState) {
    return clearStateCookie(
      NextResponse.redirect(
        getPublicRequestUrl(request, `/super-admin/platform-settings?error=${encodeURIComponent("YouTube OAuth state did not match. Start the connection flow again.")}`),
      ),
    );
  }

  try {
    await exchangeYouTubeCodeForSharedConnection(code);
    return clearStateCookie(
      NextResponse.redirect(getPublicRequestUrl(request, "/super-admin/platform-settings?message=YouTube%20channel%20connected%20successfully.")),
    );
  } catch (callbackError) {
    const message = callbackError instanceof Error ? callbackError.message : "Unable to complete the YouTube connection.";
    return clearStateCookie(
      NextResponse.redirect(getPublicRequestUrl(request, `/super-admin/platform-settings?error=${encodeURIComponent(message)}`)),
    );
  }
}
