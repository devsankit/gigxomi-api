import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

type SignatureVerificationResult =
  | { ok: true; rawBody: string; bypassed: boolean }
  | { ok: false; rawBody: string; status: number; error: string };

function localBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.WHATSAPP_WEBHOOK_SIGNATURE_BYPASS === "true";
}

function shouldRequireSignatureWhenSecretIsMissing() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.WHATSAPP_WEBHOOK_REQUIRE_SIGNATURE === "true" ||
    process.env.META_WEBHOOK_SIGNATURE_REQUIRED?.trim() === "1"
  );
}

function getMetaAppSecrets() {
  // A single Gigxomi deployment can receive callbacks from separate Meta apps.
  // Verify against every explicitly trusted server-side app secret so enabling
  // Instagram cannot silently replace the WhatsApp signing secret.
  return Array.from(
    new Set(
      [
        process.env.META_WHATSAPP_APP_SECRET,
        process.env.WHATSAPP_APP_SECRET,
        process.env.META_APP_SECRET,
        process.env.FACEBOOK_APP_SECRET,
        process.env.GIGXOMI_META_APP_SECRET,
        process.env.INSTAGRAM_CLIENT_SECRET,
        process.env.INSTAGRAM_APP_SECRET,
      ]
        .map((value) => value?.trim() ?? "")
        .filter(Boolean),
    ),
  );
}

function getSignatureHex(signatureHeader: string | null) {
  const normalized = String(signatureHeader ?? "").trim();
  if (!normalized.startsWith("sha256=")) return "";
  return normalized.slice("sha256=".length).trim();
}

export async function verifyWhatsAppWebhookSignature(request: Request): Promise<SignatureVerificationResult> {
  const rawBody = await request.text();
  const appSecrets = getMetaAppSecrets();

  if (!appSecrets.length) {
    if (localBypassEnabled() || !shouldRequireSignatureWhenSecretIsMissing()) {
      return { ok: true, rawBody, bypassed: true };
    }

    return {
      ok: false,
      rawBody,
      status: 403,
      error: "WhatsApp webhook signature verification is not configured.",
    };
  }

  const signatureHex = getSignatureHex(request.headers.get("x-hub-signature-256"));
  if (!/^[a-f\d]{64}$/i.test(signatureHex)) {
    if (localBypassEnabled()) {
      return { ok: true, rawBody, bypassed: true };
    }

    return {
      ok: false,
      rawBody,
      status: 403,
      error: "WhatsApp webhook signature header is missing.",
    };
  }

  const receivedBuffer = Buffer.from(signatureHex, "hex");
  const signatureMatches = appSecrets.some((appSecret) => {
    const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  });
  if (!signatureMatches) {
    return {
      ok: false,
      rawBody,
      status: 403,
      error: "WhatsApp webhook signature verification failed.",
    };
  }

  return { ok: true, rawBody, bypassed: false };
}
