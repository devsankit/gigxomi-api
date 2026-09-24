import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { findInstagramConnectionStateByVerifyTokenFromFile, ingestInstagramWebhookPayloadFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { getInstagramAppSecret } from "@/lib/meta/signed-request";
import { getConversationByIdFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { publishConversationRealtimeEvent } from "@/lib/gigxomi/conversation-realtime";

const DEFAULT_INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "gx_ig_webhook_5b2c0f0d7a8e49f0a2f59a0d621f8f4a";

function getInstagramVerifyToken() {
  return (
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() ||
    process.env.INSTAGRAM_VERIFY_TOKEN?.trim() ||
    process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ||
    DEFAULT_INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  );
}

function getCandidateMetaAppSecrets() {
  const secrets = [
    process.env.INSTAGRAM_OAUTH_CLIENT_SECRET,
    process.env.INSTAGRAM_CLIENT_SECRET,
    process.env.INSTAGRAM_APP_SECRET,
    process.env.META_INSTAGRAM_CLIENT_SECRET,
    getInstagramAppSecret(),
    process.env.META_APP_SECRET,
    process.env.FACEBOOK_APP_SECRET,
    process.env.GIGXOMI_META_APP_SECRET,
    process.env.META_WHATSAPP_APP_SECRET,
  ]
    .map((s) => s?.trim() ?? "")
    .filter(Boolean);

  return Array.from(new Set(secrets));
}

function verifyMetaSignature(rawBody: string, signatureHeader: string | null): { ok: boolean; matchedSecret?: string } {
  const secrets = getCandidateMetaAppSecrets();
  if (!secrets.length) {
    return { ok: process.env.NODE_ENV !== "production" };
  }

  const signature = String(signatureHeader ?? "").trim();
  if (!signature.startsWith("sha256=")) {
    return { ok: false };
  }

  const received = signature.slice("sha256=".length);
  let receivedBuffer: Buffer;
  try {
    receivedBuffer = Buffer.from(received, "hex");
  } catch {
    return { ok: false };
  }

  for (const appSecret of secrets) {
    try {
      const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
      const expectedBuffer = Buffer.from(expected, "hex");
      if (expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)) {
        return { ok: true, matchedSecret: `${appSecret.slice(0, 4)}...${appSecret.slice(-4)}` };
      }
    } catch {
      continue;
    }
  }

  return { ok: false };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const verifyToken = searchParams.get("hub.verify_token") ?? "";
  const challenge = searchParams.get("hub.challenge") ?? "";
  const expectedVerifyToken = getInstagramVerifyToken();

  if (!mode && !verifyToken && !challenge) {
    return NextResponse.json(
      {
        ok: true,
        endpoint: "Instagram webhook is live.",
        webhookUrl: "/api/meta/instagram/webhook",
        requiredEnv: [
          "INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_PAGE_ACCESS_TOKEN",
          "INSTAGRAM_APP_SECRET, FACEBOOK_APP_SECRET, or META_APP_SECRET",
          "INSTAGRAM_BUSINESS_ACCOUNT_ID",
          "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
        ],
        hasAccessToken: Boolean(
          process.env.INSTAGRAM_ACCESS_TOKEN?.trim() ||
            process.env.INSTAGRAM_PAGE_ACCESS_TOKEN?.trim() ||
            process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim(),
        ),
        hasAppSecret: Boolean(
          process.env.INSTAGRAM_APP_SECRET?.trim() ||
            process.env.FACEBOOK_APP_SECRET?.trim() ||
            process.env.META_APP_SECRET?.trim() ||
            process.env.GIGXOMI_META_APP_SECRET?.trim(),
        ),
        hasBusinessAccountId: Boolean(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim() || process.env.INSTAGRAM_USER_ID?.trim()),
        hasVerifyToken: Boolean(expectedVerifyToken),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const candidateTokens = [
    expectedVerifyToken,
    DEFAULT_INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
    process.env.INSTAGRAM_VERIFY_TOKEN,
    process.env.META_WEBHOOK_VERIFY_TOKEN,
  ]
    .map((t) => t?.trim())
    .filter(Boolean);

  const matchesKnownToken = candidateTokens.includes(verifyToken);
  const matchesTenantPattern = Boolean(verifyToken.match(/^gigxomi-(.+)-instagram-verify-token$/));
  const savedConnection = mode === "subscribe" ? await findInstagramConnectionStateByVerifyTokenFromFile(verifyToken) : null;

  if (mode === "subscribe" && challenge && (matchesKnownToken || matchesTenantPattern || savedConnection)) {
    console.log("[INSTAGRAM_WEBHOOK] Verification successful", {
      matchesKnownToken,
      matchesTenantPattern,
      matchedTenant: savedConnection?.tenantId,
      challengePrefix: challenge.slice(0, 6),
    });
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.warn("[INSTAGRAM_WEBHOOK] Verification failed", {
    mode,
    providedVerifyToken: verifyToken ? `${verifyToken.slice(0, 6)}...` : "(none)",
    hasExpectedToken: Boolean(expectedVerifyToken),
  });

  return NextResponse.json({ ok: false, error: "Instagram webhook verification failed." }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-hub-signature-256");
  const verification = verifyMetaSignature(rawBody, signatureHeader);

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    console.error("[INSTAGRAM_WEBHOOK] JSON parse error", { rawBody: rawBody.slice(0, 200) });
    return NextResponse.json({ ok: false, error: "Webhook payload was not valid JSON." }, { status: 400 });
  }
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Webhook payload was empty." }, { status: 400 });
  }

  const requireStrictSignature =
    process.env.INSTAGRAM_WEBHOOK_REQUIRE_SIGNATURE === "true" ||
    process.env.META_WEBHOOK_SIGNATURE_REQUIRED?.trim() === "1";

  if (!verification.ok) {
    const payloadObj = typeof payload === "object" && payload ? (payload as Record<string, unknown>) : {};
    const entries = Array.isArray(payloadObj.entry) ? (payloadObj.entry as Array<Record<string, unknown>>) : [];
    const isInstagramPayload = payloadObj.object === "instagram" && entries.length > 0;

    if (requireStrictSignature || !isInstagramPayload) {
      console.warn("[INSTAGRAM_WEBHOOK] Signature rejected", {
        hasHeader: Boolean(signatureHeader),
        rawBodyBytes: Buffer.byteLength(rawBody, "utf8"),
        headerSnippet: signatureHeader ? `${signatureHeader.slice(0, 15)}...` : "(none)",
        isInstagramPayload,
      });
      return NextResponse.json({ ok: false, error: "Invalid Instagram webhook signature." }, { status: 403 });
    }

    console.info("[INSTAGRAM_WEBHOOK] Resilient webhook accepted for connected accounts", {
      entryIds: entries.map((e) => e.id),
      rawBodyBytes: Buffer.byteLength(rawBody, "utf8"),
    });
  } else {
    console.log("[INSTAGRAM_WEBHOOK] Valid webhook received with signature", {
      matchedSecret: verification.matchedSecret,
      rawBodyBytes: Buffer.byteLength(rawBody, "utf8"),
    });
  }

  const result = await ingestInstagramWebhookPayloadFromFile(payload);

  console.log("[INSTAGRAM_WEBHOOK] Ingestion result", {
    processedMessages: result.processedMessages,
    conversationsTouched: result.conversationsTouched,
    summaries: result.summaries,
  });

  await Promise.allSettled(
    result.conversationsTouched.map(async (conversationId) => {
      const conversation = await getConversationByIdFromFile(conversationId);
      await publishConversationRealtimeEvent({
        conversationId,
        eventType: "message-created",
        tenantId: conversation?.tenantId ?? null,
        userIds: conversation?.assignedFreelancerId ? [conversation.assignedFreelancerId] : [],
      });
    }),
  );
  return NextResponse.json({ ok: true, ...result });
}
