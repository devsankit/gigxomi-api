import { NextResponse } from "next/server";

import {
  findWhatsAppConnectionStateByVerifyTokenFromFile,
  ingestWhatsAppWebhookPayloadFromFile,
  listWhatsAppConnectionStatesFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { processPublicAuthWebhookPayload } from "@/lib/auth/public-whatsapp";
import { getWhatsAppWebhookUrl } from "@/lib/gigxomi/dummy-platform-store";
import { executeWhatsAppFlowsFromWebhook } from "@/lib/gigxomi/whatsapp-flow-engine";
import { verifyWhatsAppWebhookSignature } from "@/lib/gigxomi/whatsapp-webhook-security";
import { sendMobileChatPushForConversation } from "@/lib/mobile-chat-push";
import { getConversationByIdFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { publishConversationRealtimeEvent } from "@/lib/gigxomi/conversation-realtime";
import {
  markWhatsAppWebhookMessagesProcessed,
  routeAndRecordWhatsAppWebhook,
} from "@/lib/gigxomi/whatsapp-webhook-routing";

function verifyTokenMatchesGlobalEnv(token: string | null) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || "";
  return Boolean(expected && token?.trim() === expected);
}

function logWhatsAppOnboardingStep(step: string, payload?: unknown) {
  console.info(`[WHATSAPP_ONBOARDING] ${step}`, payload ?? {});
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const verifyToken = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge") ?? "";
  const expectedWebhookUrl = "https://gigxomi.com/api/meta/whatsapp/webhook";
  logWhatsAppOnboardingStep("WEBHOOK_VERIFY_REQUEST", {
    requestPath: new URL(request.url).pathname,
    expectedWebhookUrl,
    mode,
    hasVerifyToken: Boolean(verifyToken),
    hasChallenge: Boolean(challenge),
  });

  if (!mode && !verifyToken && !challenge) {
    const connections = await listWhatsAppConnectionStatesFromFile();
    const enabledConnections = connections.filter((connection) => connection.pluginEnabled);

    return NextResponse.json(
      {
        ok: true,
        isLive: true,
        hasEnabledConnection: enabledConnections.length > 0,
        hasRoutableConnection: enabledConnections.some(
          (connection) =>
            Boolean(connection.phoneNumberId.trim()) &&
            Boolean(connection.verifyToken.trim()) &&
            Boolean(getWhatsAppWebhookUrl(connection)),
        ),
        hasOtpReadyConnection: enabledConnections.some(
          (connection) =>
            Boolean(connection.phoneNumberId.trim()) &&
            Boolean(connection.accessToken.trim()),
        ),
        hasRecentInbound: enabledConnections.some((connection) => Boolean(connection.lastInboundAt)),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const connection = await findWhatsAppConnectionStateByVerifyTokenFromFile(verifyToken);

  if (mode === "subscribe" && ((connection?.verifyToken && verifyToken === connection.verifyToken) || verifyTokenMatchesGlobalEnv(verifyToken))) {
    logWhatsAppOnboardingStep("WEBHOOK_VERIFY_SUCCESS", {
      requestPath: new URL(request.url).pathname,
      expectedWebhookUrl,
      tenantId: connection?.tenantId ?? null,
      challengeLength: challenge.length,
    });
    logWhatsAppOnboardingStep("STEP_10_WEBHOOK_VALIDATED", {
      webhookPath: new URL(request.url).pathname,
      tenantId: connection?.tenantId ?? null,
      hasAppSecret: Boolean(process.env.META_APP_SECRET?.trim() || process.env.FACEBOOK_APP_SECRET?.trim() || process.env.GIGXOMI_META_APP_SECRET?.trim()),
      subscriptionFields: ["messages"],
      challengeLength: challenge.length,
    });
    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  logWhatsAppOnboardingStep("WEBHOOK_VERIFY_FAILED", {
    requestPath: new URL(request.url).pathname,
    expectedWebhookUrl,
    mode,
    hasVerifyToken: Boolean(verifyToken),
    tenantId: connection?.tenantId ?? null,
    hasMatchingTenantToken: Boolean(connection?.verifyToken && verifyToken === connection.verifyToken),
    hasMatchingGlobalToken: verifyTokenMatchesGlobalEnv(verifyToken),
  });
  return NextResponse.json(
    {
      ok: false,
      error: "Webhook verification failed. Check the verify token in Meta and in the admin WhatsApp setup page.",
    },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  const signature = await verifyWhatsAppWebhookSignature(request);
  if (!signature.ok) {
    // Keep delivery diagnostics safe: record only the failure category and
    // status, never the payload, signature, phone number, or any token.
    console.warn("[WHATSAPP_ONBOARDING] WHATSAPP_WEBHOOK_REJECTED", {
      status: signature.status,
      reason: signature.error,
    });
    return NextResponse.json({ ok: false, processed: false, error: signature.error }, { status: signature.status });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(signature.rawBody || "null") as unknown;
  } catch {
    return NextResponse.json({ ok: true, processed: false, error: "Webhook payload was not valid JSON." }, { status: 200 });
  }

  if (!payload) {
    return NextResponse.json({ ok: true, processed: false, error: "Webhook payload was empty." }, { status: 200 });
  }

  const routed = await routeAndRecordWhatsAppWebhook(payload);
  payload = routed.payload;
  const payloadRecord = typeof payload === "object" && payload && !Array.isArray(payload) ? payload as { object?: unknown; entry?: unknown[] } : null;
  logWhatsAppOnboardingStep("WHATSAPP_WEBHOOK_RECEIVED", {
    requestPath: new URL(request.url).pathname,
    signatureValid: true,
    signatureBypassed: signature.bypassed,
    payloadObject: typeof payloadRecord?.object === "string" ? payloadRecord.object : null,
    entryCount: Array.isArray(payloadRecord?.entry) ? payloadRecord.entry.length : 0,
    rawBodyBytes: Buffer.byteLength(signature.rawBody, "utf8"),
  });
  // Meta includes the authoritative `phone_number_id` on the inbound webhook.
  // Persist it before handling `Get OTP`: a newly connected public line may
  // not have that ID saved yet, and sending the OTP first would always fail.
  // Auth processing still receives the original payload; it only decides how
  // to reply and does not need to ingest the message a second time.
  const result = await ingestWhatsAppWebhookPayloadFromFile(payload);
  const authProcessed = await processPublicAuthWebhookPayload(payload);
  const pushTargets = result.processedMessages > 0 ? result.conversationsTouched : [];
  const mobilePushPromise = Promise.allSettled(
    pushTargets.map((conversationId) =>
      sendMobileChatPushForConversation({
        conversationId,
        senderId: "external-whatsapp",
        senderRole: "customer",
      }),
    ),
  );
  await Promise.allSettled(
    pushTargets.map(async (conversationId) => {
      const conversation = await getConversationByIdFromFile(conversationId);
      await publishConversationRealtimeEvent({
        conversationId,
        eventType: "message-created",
        tenantId: conversation?.tenantId ?? null,
        userIds: conversation?.assignedFreelancerId ? [conversation.assignedFreelancerId] : [],
      });
    }),
  );
  const flowResult =
    authProcessed.handledMessages > 0
      ? { handledMessages: 0, duplicateMessages: 0, unmappedTenantMessages: 0, statusEvents: 0, runs: [] }
      : await executeWhatsAppFlowsFromWebhook(authProcessed.payload).catch((error) => ({
          handledMessages: 0,
          duplicateMessages: 0,
          unmappedTenantMessages: 0,
          statusEvents: 0,
          runs: [],
          error: error instanceof Error ? error.message : "Flow runtime failed.",
        }));
  await markWhatsAppWebhookMessagesProcessed(routed.resolvedMessageIds);
  const mobilePushResults = await Promise.race([
    mobilePushPromise,
    new Promise<PromiseSettledResult<unknown>[]>((resolve) => setTimeout(() => resolve([]), 400)),
  ]);

  return NextResponse.json({
    ok: true,
    publicAuthHandledMessages: authProcessed.handledMessages,
    publicAuthSummaries: authProcessed.summaries,
    flowHandledMessages: flowResult.handledMessages,
    flowDuplicateMessages: flowResult.duplicateMessages,
    flowUnmappedTenantMessages: flowResult.unmappedTenantMessages,
    flowStatusEvents: flowResult.statusEvents,
    flowRuns: flowResult.runs,
    mobilePushQueued: mobilePushResults.filter((entry) => entry.status === "fulfilled").length,
    quarantinedMessages: routed.unresolvedMessageIds.length,
    ...result,
  });
}
