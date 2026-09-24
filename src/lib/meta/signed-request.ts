import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaSignedRequestPayload = {
  algorithm?: string;
  issued_at?: number;
  user_id?: string;
  [key: string]: unknown;
};

export function getMetaAppSecret() {
  return (
    process.env.META_APP_SECRET?.trim() ||
    process.env.FACEBOOK_APP_SECRET?.trim() ||
    process.env.GIGXOMI_META_APP_SECRET?.trim() ||
    ""
  );
}

export function getInstagramAppSecret() {
  const dedicatedSecret =
    process.env.INSTAGRAM_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.INSTAGRAM_CLIENT_SECRET?.trim() ||
    process.env.INSTAGRAM_APP_SECRET?.trim() ||
    process.env.META_INSTAGRAM_CLIENT_SECRET?.trim();
  if (dedicatedSecret) {
    return dedicatedSecret;
  }

  const instagramAppId = process.env.INSTAGRAM_OAUTH_CLIENT_ID?.trim() || process.env.NEXT_PUBLIC_INSTAGRAM_OAUTH_CLIENT_ID?.trim() || "";
  const sharedMetaAppId = process.env.META_WHATSAPP_APP_ID?.trim() || process.env.META_APP_ID?.trim() || process.env.FACEBOOK_APP_ID?.trim() || "";
  if (instagramAppId && sharedMetaAppId && instagramAppId !== sharedMetaAppId) {
    return "";
  }

  return getMetaAppSecret();
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

export function parseMetaSignedRequest(signedRequest: string, appSecret = getMetaAppSecret()) {
  const [encodedSignature, encodedPayload] = signedRequest.split(".");
  if (!encodedSignature || !encodedPayload) {
    return { ok: false as const, error: "Meta signed_request is missing or malformed." };
  }

  if (!appSecret) {
    return { ok: false as const, error: "Meta app secret is not configured on the server." };
  }

  let payload: MetaSignedRequestPayload;
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload).toString("utf8")) as MetaSignedRequestPayload;
  } catch {
    return { ok: false as const, error: "Meta signed_request payload could not be decoded." };
  }

  if (String(payload.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") {
    return { ok: false as const, error: "Meta signed_request used an unsupported algorithm." };
  }

  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  const received = decodeBase64Url(encodedSignature);
  const verified = received.length === expected.length && timingSafeEqual(received, expected);

  if (!verified) {
    return { ok: false as const, error: "Meta signed_request signature verification failed." };
  }

  return { ok: true as const, payload };
}
