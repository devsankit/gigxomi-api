import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deliveryRetryDelay, publicMetaUrl, validBrowserId, type ConversionEventName, type ConversionSource } from "./conversion-contract";

export type MetaConversionInput = {
  eventName: ConversionEventName;
  source: ConversionSource;
  eventId: string;
  eventTime?: number;
  eventSourceUrl?: string;
  userData?: { phone?: string; email?: string; fbp?: string; fbc?: string; clientIpAddress?: string; clientUserAgent?: string; ctwaClid?: string; wabaId?: string };
  tenantId?: string;
  conversationId?: string;
  externalMessageId?: string;
};

export function getMetaConversionConfig(source: ConversionSource = "WEB") {
  const enabled = process.env.META_CAPI_ENABLED === "true";
  const whatsapp = source === "WHATSAPP";
  return {
    enabled,
    websiteEnabled: enabled && process.env.META_CAPI_WEBSITE_ENABLED === "true",
    datasetId: (whatsapp ? process.env.META_CAPI_WHATSAPP_DATASET_ID : process.env.META_CAPI_DATASET_ID)?.trim() || "",
    accessToken: enabled ? (whatsapp ? process.env.META_CAPI_WHATSAPP_ACCESS_TOKEN : process.env.META_CAPI_ACCESS_TOKEN)?.trim() || "" : "",
    version: /^v\d+\.\d+$/.test(process.env.META_CAPI_GRAPH_VERSION ?? "") ? process.env.META_CAPI_GRAPH_VERSION! : "v25.0",
  };
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function buildMetaEvent(input: MetaConversionInput) {
  const user: Record<string, string | string[]> = {};
  const event: Record<string, unknown> = {
    event_name: input.eventName, event_id: input.eventId,
    event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
    action_source: input.source === "WHATSAPP" ? "business_messaging" : "website",
    custom_data: { source_surface: input.source.toLowerCase() }, user_data: user,
  };
  if (input.source === "WHATSAPP") {
    if (!input.userData?.ctwaClid || !/^\d+$/.test(input.userData.wabaId ?? "") || input.eventName !== "LeadSubmitted") throw new Error("invalid_messaging_attribution");
    event.messaging_channel = "whatsapp";
    user.ctwa_clid = input.userData.ctwaClid; // Original click ID; never hashed or fabricated.
    user.whatsapp_business_account_id = input.userData.wabaId!;
  } else {
    const url = publicMetaUrl(input.eventSourceUrl ?? "");
    if (!url || input.eventName === "LeadSubmitted") throw new Error("invalid_public_event");
    event.event_source_url = url;
    if (input.userData?.phone) user.ph = [hash(input.userData.phone.replace(/\D/g, "").replace(/^00/, ""))];
    if (input.userData?.email) user.em = [hash(input.userData.email.trim().toLowerCase())];
    const fbp = validBrowserId(input.userData?.fbp), fbc = validBrowserId(input.userData?.fbc);
    if (fbp) user.fbp = fbp;
    if (fbc) user.fbc = fbc;
    if (input.userData?.clientIpAddress) user.client_ip_address = input.userData.clientIpAddress;
    if (input.userData?.clientUserAgent) user.client_user_agent = input.userData.clientUserAgent.slice(0, 500);
  }
  return event;
}

/** Durable outbox only: no Meta network call in a customer request. */
export async function enqueueMetaConversion(input: MetaConversionInput, status = "PENDING") {
  const config = getMetaConversionConfig(input.source);
  if (!/^\d+$/.test(config.datasetId) || !config.accessToken) return { queued: false, reason: "not_configured" };
  if (input.source !== "WHATSAPP" && !config.websiteEnabled) return { queued: false, reason: "website_disabled" };
  const event = buildMetaEvent(input);
  await prisma.metaConversionEvent.upsert({
    where: { eventId: input.eventId },
    create: {
      eventId: input.eventId, eventName: input.eventName, source: input.source, datasetId: config.datasetId,
      tenantId: input.tenantId, conversationId: input.conversationId, externalMessageId: input.externalMessageId,
      status, metadata: event as Prisma.InputJsonValue,
    },
    update: {}, // Replays cannot replace original attribution or successful state.
  });
  return { queued: true, eventId: input.eventId };
}

export async function deliverMetaConversions(eventId?: string) {
  const webConfig = getMetaConversionConfig();
  const whatsappConfig = getMetaConversionConfig("WHATSAPP");
  const destinations = [
    ...(webConfig.websiteEnabled && webConfig.accessToken && /^\d+$/.test(webConfig.datasetId) ? [{ datasetId: webConfig.datasetId, source: { in: ["WEB", "WEBINAR"] } }] : []),
    ...(whatsappConfig.accessToken && /^\d+$/.test(whatsappConfig.datasetId) ? [{ datasetId: whatsappConfig.datasetId, source: { in: ["WHATSAPP"] } }] : []),
  ];
  if (!destinations.length) return { sent: 0, failed: 0, configured: false };
  const now = new Date();
  await prisma.metaConversionEvent.updateMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * 86400000) }, status: { notIn: ["EXPIRED", "SENT", "DEAD"] } }, data: { status: "EXPIRED", metadata: {} } });
  await prisma.metaConversionEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86400000) } } });
  const rows = await prisma.metaConversionEvent.findMany({
    where: { ...(eventId ? { eventId } : {}), AND: [{ OR: destinations }, { OR: [{ status: "PENDING" }, { status: "FAILED" }, { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - 120000) } }] }] },
    orderBy: { updatedAt: "asc" }, take: 40,
  });
  let sent = 0, failed = 0;
  for (const row of rows) {
    const config = row.source === "WHATSAPP" ? whatsappConfig : webConfig;
    if (row.status === "FAILED" && now.getTime() - row.updatedAt.getTime() < deliveryRetryDelay(row.attemptCount)) continue;
    const claimed = await prisma.metaConversionEvent.updateMany({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt }, data: { status: "SENDING", attemptCount: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      const response = await fetch(`https://graph.facebook.com/${config.version}/${row.datasetId}/events`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.accessToken}` },
        body: JSON.stringify({ data: [row.metadata] }), signal: AbortSignal.timeout(4000),
      });
      const body = await response.json().catch(() => ({})) as { events_received?: number; fbtrace_id?: string; error?: { code?: number } };
      if (!response.ok || body.error || body.events_received !== 1) throw new Error(`meta_${body.error?.code ?? response.status}`);
      await prisma.metaConversionEvent.update({ where: { id: row.id }, data: { status: "SENT", traceId: body.fbtrace_id, lastError: null, metadata: {} } });
      sent++;
    } catch (error) {
      const reason = error instanceof Error && /^meta_\d+$/.test(error.message) ? error.message : "request_failed";
      const exhausted = row.attemptCount >= 19;
      await prisma.metaConversionEvent.update({ where: { id: row.id }, data: { status: exhausted ? "DEAD" : "FAILED", lastError: reason, ...(exhausted ? { metadata: {} } : {}) } });
      failed++;
    }
  }
  return { sent, failed, configured: true };
}
