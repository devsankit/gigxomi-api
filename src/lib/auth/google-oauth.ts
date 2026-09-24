import { createHash, randomBytes } from "node:crypto";

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri: redirectUri || "http://localhost:3011/api/auth/google/callback",
  };
}

export function isGoogleOAuthAvailable(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function generatePkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateOAuthState(payload: Record<string, string> = {}) {
  const random = randomBytes(16).toString("hex");
  const raw = JSON.stringify({ ...payload, r: random });
  return Buffer.from(raw).toString("base64url");
}

export function parseOAuthState(stateString: string): Record<string, string> | null {
  try {
    const raw = Buffer.from(stateString, "base64url").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
};

export async function exchangeGoogleCodeForTokens(code: string, verifier: string, config: GoogleOAuthConfig) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} ${errorText}`);
  }

  return (await response.json()) as {
    access_token: string;
    id_token: string;
    expires_in: number;
    token_type: string;
  };
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google userinfo fetch failed: ${response.status} ${errorText}`);
  }

  return (await response.json()) as GoogleUserInfo;
}
