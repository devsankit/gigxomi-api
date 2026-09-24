import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSalesLeadPoolItem } from "@/lib/gigxomi/sales-store";
import { enqueueMetaConversion, getMetaConversionConfig } from "./conversions-api";

/** Independent reader: the production webhook/OTP/realtime routes do not import this. */
export async function captureWhatsAppAdLeads() {
  const tenant = process.env.META_CAPI_WHATSAPP_TENANT_ID?.trim();
  const phoneId = process.env.META_CAPI_WHATSAPP_PHONE_NUMBER_ID?.trim();
  const start = new Date(process.env.META_CAPI_WHATSAPP_START_AT ?? "invalid");
  const config = getMetaConversionConfig("WHATSAPP");
  if (!tenant || !phoneId || !Number.isFinite(start.getTime()) || !config.accessToken || !/^\d+$/.test(config.datasetId)) return { captured: 0, configured: false };
  const since = new Date(Math.max(start.getTime(), Date.now() - 7 * 86400000));
  const rows = await prisma.$queryRaw<Array<{ messageId: string; payloadJson: Prisma.JsonValue }>>`
    SELECT w."messageId", w."payloadJson" FROM whatsapp_webhook_message_events w
    WHERE w.provider = 'whatsapp_cloud_api' AND w."tenantId" = ${tenant} AND w."phoneNumberId" = ${phoneId}
      AND w."processedAt" IS NOT NULL AND w."createdAt" >= ${since}
      AND w."payloadJson"->>'routingStatus' = 'resolved'
      AND w."payloadJson"->'message'->'referral'->>'ctwa_clid' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM meta_conversion_events e WHERE e."externalMessageId" = w."messageId" AND e.source = 'WHATSAPP')
    ORDER BY w."createdAt" ASC LIMIT 100`;
  let captured = 0;
  for (const row of rows) {
    const payload = row.payloadJson as { entryId?: string; metadata?: { display_phone_number?: string }; message?: { timestamp?: string; referral?: { ctwa_clid?: string } } };
    const clickId = payload.message?.referral?.ctwa_clid;
    const receivedAt = Number(payload.message?.timestamp);
    const recipient = (payload.metadata?.display_phone_number ?? "").replace(/\D/g, "");
    if (recipient !== "919993328124" || !clickId || !/^\d+$/.test(payload.entryId ?? "") || !Number.isFinite(receivedAt) || receivedAt * 1000 < since.getTime() || receivedAt > Date.now() / 1000 + 60) continue;
    // Match the exact saved external message AND tenant/channel, never phone suffixes.
    const candidates = await prisma.appConversation.findMany({
      where: { tenantId: tenant, payload: { path: ["messages"], array_contains: [{ externalMessageId: row.messageId }] } },
      select: { id: true, customerName: true, customerPhone: true, payload: true }, take: 2,
    });
    if (candidates.length !== 1 || (candidates[0].payload as { sourceChannel?: string }).sourceChannel !== "whatsapp") continue;
    const conversation = candidates[0];
    await createSalesLeadPoolItem({ conversationId: conversation.id, customerName: conversation.customerName, customerPhone: conversation.customerPhone,
      source: "meta_click_to_whatsapp", serviceInterest: "WhatsApp ad enquiry", segment: "whatsapp_ad", priority: "normal", notes: "Ad enquiry received; qualify in Sales before reporting a conversion." });
    await enqueueMetaConversion({ eventName: "LeadSubmitted", source: "WHATSAPP", eventId: `wa_lead_${createHash("sha256").update(row.messageId).digest("hex")}`,
      eventTime: receivedAt, tenantId: tenant, conversationId: conversation.id, externalMessageId: row.messageId, userData: { ctwaClid: clickId, wabaId: payload.entryId } }, "ATTRIBUTED");
    captured++;
  }
  // Qualification is an explicit, audited CRM action. Stages/tags alone never send events.
  return { captured, configured: true };
}
