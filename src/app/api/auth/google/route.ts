import { NextResponse } from "next/server";
import { generateOAuthState, generatePkcePair, getGoogleOAuthConfig } from "@/lib/auth/google-oauth";

export async function GET(request: Request) {
  const config = getGoogleOAuthConfig();
  const url = new URL(request.url);
  const role = url.searchParams.get("role") || "agency";
  const redirectTo = url.searchParams.get("redirectTo") || "";

  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        error: "Google OAuth is not configured. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required.",
      },
      { status: 400 }
    );
  }

  const { verifier, challenge } = generatePkcePair();
  const state = generateOAuthState({ role, redirectTo });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(authUrl.toString());

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10 minutes
  };

  response.cookies.set("gx_google_oauth_state", state, cookieOptions);
  response.cookies.set("gx_google_oauth_verifier", verifier, cookieOptions);

  return response;
}

export async function POST(request: Request) {
  return GET(request);
}
