import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { getPhonePeConfig } from "@/lib/billing/phonepe-config";

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function expectedWebhookAuth() {
  const config = getPhonePeConfig();
  if (!config.webhookUsername || !config.webhookPassword) return null;
  return createHash("sha256").update(`${config.webhookUsername}:${config.webhookPassword}`).digest("hex");
}

export function verifyPhonePeWebhookAuthorization(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = expectedWebhookAuth();
  return Boolean(expected) && safeCompare(authorization, expected!);
}

export function buildLegacyXVerify(payload: string, path: string) {
  const config = getPhonePeConfig();
  if (!config.saltKey || !config.saltIndex) {
    throw new Error("PhonePe salt credentials are required for legacy X-VERIFY signing.");
  }
  const hash = createHash("sha256").update(`${payload}${path}${config.saltKey}`).digest("hex");
  return `${hash}###${config.saltIndex}`;
}

export async function readVerifiedPhonePeWebhook(request: Request) {
  if (!verifyPhonePeWebhookAuthorization(request)) {
    return { ok: false as const, status: 401, error: "Invalid PhonePe webhook authorization." };
  }

  const rawBody = await request.text();
  try {
    const payload = rawBody ? JSON.parse(rawBody) : {};
    return { ok: true as const, rawBody, payload };
  } catch {
    return { ok: false as const, status: 400, error: "PhonePe webhook body must be valid JSON." };
  }
}
