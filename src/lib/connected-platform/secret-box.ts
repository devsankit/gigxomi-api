import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function getKey() {
  const secret =
    process.env.CONNECTED_PLATFORM_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.CONNECTED_PLATFORM_OAUTH_STATE_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.META_APP_SECRET?.trim() ||
    "gx_connected_platform_default_key_2026";
  return createHash("sha256").update(secret).digest();
}

export function encryptConnectedSecret(value: string) {
  if (!value) return "";
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  } catch {
    return "";
  }
}

export function decryptConnectedSecret(value: string) {
  if (!value?.trim()) return "";
  try {
    const [ivValue, tagValue, payloadValue] = value.split(".");
    if (!ivValue || !tagValue || !payloadValue) return "";
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(payloadValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
