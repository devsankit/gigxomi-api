import { NextResponse } from "next/server";

import { getPublicRequestUrl } from "@/lib/auth/request-url";
import { getSessionContext } from "@/lib/auth/session";
import { SUPER_ADMIN_LOGIN_ROUTE } from "@/lib/auth/super-admin-config";
import { getPlatformYouTubeConnectUrl, getPlatformYouTubeConnectionView } from "@/lib/gigxomi/platform-youtube";

const YOUTUBE_OAUTH_STATE_COOKIE = "gx_youtube_oauth_state";

export async function GET(request: Request) {
  const session = await getSessionContext();
  if (session.role !== "SUPER_ADMIN") {
    return NextResponse.redirect(
      getPublicRequestUrl(request, `${SUPER_ADMIN_LOGIN_ROUTE}?error=${encodeURIComponent("Super-admin login is required before connecting the shared YouTube channel.")}`),
    );
  }

  const connection = await getPlatformYouTubeConnectionView();
  if (!connection.envReady) {
    return NextResponse.redirect(
      getPublicRequestUrl(
        request,
        `/super-admin/platform-settings?error=${encodeURIComponent(`YouTube env is missing: ${connection.missingEnv.join(", ")}`)}`,
      ),
    );
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(getPlatformYouTubeConnectUrl(state));
  response.cookies.set(YOUTUBE_OAUTH_STATE_COOKIE, state, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 15,
  });
  return response;
}
