export const INSTAGRAM_OAUTH_CALLBACK_PATH = "/api/meta/instagram/oauth/callback";
export const INSTAGRAM_DEAUTHORIZE_CALLBACK_PATH = "/api/meta/instagram/deauthorize";
export const INSTAGRAM_DATA_DELETION_CALLBACK_PATH = "/api/meta/instagram/data-deletion";
export const INSTAGRAM_WEBHOOK_PATH = "/api/meta/instagram/webhook";

export function normalizePublicOrigin(value?: string | null) {
  const rawValue = (value?.trim() || "https://gigxomi.com").replace(/\/+$/, "");
  const urlValue = rawValue.includes("://") ? rawValue : `https://${rawValue}`;

  try {
    const url = new URL(urlValue);
    if (url.hostname === "gigxomi.com" || url.hostname.endsWith(".gigxomi.com")) {
      url.protocol = "https:";
    }
    return url.origin;
  } catch {
    return rawValue.replace(/^http:\/\/((?:[\w-]+\.)?gigxomi\.com)$/i, "https://$1");
  }
}

export function buildInstagramMetaSetupUrls(origin?: string | null) {
  const base = normalizePublicOrigin(origin ?? process.env.INSTAGRAM_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL);
  return {
    oauthRedirectUri: `${base}${INSTAGRAM_OAUTH_CALLBACK_PATH}`,
    deauthorizeCallbackUrl: `${base}${INSTAGRAM_DEAUTHORIZE_CALLBACK_PATH}`,
    dataDeletionRequestUrl: `${base}${INSTAGRAM_DATA_DELETION_CALLBACK_PATH}`,
    webhookCallbackUrl: `${base}${INSTAGRAM_WEBHOOK_PATH}`,
  };
}
