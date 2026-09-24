import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMetaConversionConfig } from "./conversions-api";

const LABEL = "Meta qualified lead";
type Lead = { id: string; conversationId: string | null };
type Status = { state: string; eligible: boolean; qualified: boolean; message: string; eventId?: string };
export function qualificationEventId(dataset: string, conversationId: string) {
  return `wa_qualified_${createHash("sha256").update(`${dataset}:${conversationId}`).digest("hex")}`;
}
function stateFor(status: string): Status {
  if (status === "SENT") return { state: "sent", eligible: false, qualified: true, message: "Meta accepted this qualified lead." };
  if (status === "DEAD" || status === "EXPIRED") return { state: "failed", eligible: false, qualified: true, message: "Delivery stopped. Ask the administrator to check the CAPI connection." };
  return { state: status === "FAILED" ? "retrying" : "pending", eligible: false, qualified: true, message: status === "FAILED" ? "Meta delivery failed; automatic retry is scheduled." : "Qualified lead queued for Meta." };
}
async function contextFor(lead: Lead) {
  const config = getMetaConversionConfig("WHATSAPP");
  const tenantId = process.env.META_CAPI_WHATSAPP_TENANT_ID?.trim();
  if (!config.accessToken || !/^\d+$/.test(config.datasetId) || !tenantId) return null;
  if (!lead.conversationId) return null;
  // Require a worker-created, claimed queue record; arbitrary client-supplied conversation links do not qualify.
  const pool = await prisma.salesLeadPoolItem.findFirst({ where: { conversationId: lead.conversationId, convertedAssignmentId: lead.id, source: "meta_click_to_whatsapp" }, select: { id: true } });
  if (!pool) return null;
  const conversation = await prisma.appConversation.findFirst({ where: { id: lead.conversationId, tenantId }, select: { payload: true } });
  if (!conversation || (conversation.payload as { sourceChannel?: string }).sourceChannel !== "whatsapp") return null;
  return { config, tenantId, eventId: qualificationEventId(config.datasetId, lead.conversationId) };
}
async function recentAttribution(lead: Lead, tenantId: string, datasetId: string) {
  return prisma.metaConversionEvent.findFirst({ where: { conversationId: lead.conversationId, tenantId, datasetId, source: "WHATSAPP", status: "ATTRIBUTED", createdAt: { gte: new Date(Date.now() - 7 * 86400000) } }, orderBy: { createdAt: "desc" } });
}
export async function getSalesMetaStatus(lead: Lead): Promise<Status> {
  if (!getMetaConversionConfig("WHATSAPP").accessToken || !getMetaConversionConfig("WHATSAPP").datasetId) return { state: "disabled", eligible: false, qualified: false, message: "Meta WhatsApp conversion reporting is not enabled yet." };
  const context = await contextFor(lead);
  if (!context) return { state: "not_attributed", eligible: false, qualified: false, message: "No verified WhatsApp ad referral linked to this claimed lead. Organic chats are not reported as ad conversions." };
  const existing = await prisma.metaConversionEvent.findUnique({ where: { eventId: context.eventId } });
  if (existing) return { ...stateFor(existing.status), eventId: existing.eventId };
  const attribution = await recentAttribution(lead, context.tenantId, context.config.datasetId);
  return attribution ? { state: "ready", eligible: true, qualified: false, message: "Verified WhatsApp ad enquiry. Apply the label only after confirming this is a genuine, suitable lead." }
    : { state: "not_attributed", eligible: false, qualified: false, message: "No recent ad attribution is available. A normal message or CRM tag cannot create an ad click ID." };
}
export async function qualifySalesLeadForMeta(lead: Lead, actorUserId: string) {
  const context = await contextFor(lead);
  if (!context) throw new Error("This lead has no verified WhatsApp ad attribution.");
  const existing = await prisma.metaConversionEvent.findUnique({ where: { eventId: context.eventId } });
  if (existing) return { ...stateFor(existing.status), eventId: existing.eventId };
  const attribution = await recentAttribution(lead, context.tenantId, context.config.datasetId);
  const payload = attribution?.metadata as Prisma.JsonObject | undefined;
  const userData = payload?.user_data as Prisma.JsonObject | undefined;
  if (!attribution || !userData?.ctwa_clid || !userData.whatsapp_business_account_id) throw new Error("A recent WhatsApp ad click ID is required.");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.metaConversionEvent.create({ data: {
        eventId: context.eventId, eventName: "LeadSubmitted", source: "WHATSAPP", datasetId: context.config.datasetId,
        tenantId: context.tenantId, conversationId: lead.conversationId, status: "PENDING",
        metadata: { ...payload, event_name: "LeadSubmitted", event_id: context.eventId, event_time: Math.floor(Date.now() / 1000) } as Prisma.InputJsonValue,
      } });
      const current = await tx.salesLeadAssignment.findUniqueOrThrow({ where: { id: lead.id }, select: { tags: true, conversationId: true } });
      if (current.conversationId !== lead.conversationId) throw new Error("Lead conversation changed. Refresh before qualifying.");
      await tx.salesLeadAssignment.update({ where: { id: lead.id }, data: {
        tags: Array.from(new Set([...current.tags, LABEL])),
        activityLogs: { create: { actorUserId, action: "META_QUALIFIED_LEAD", note: "Applied Meta qualified lead label and queued LeadSubmitted using verified WhatsApp ad attribution." } },
      } });
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    const raced = await prisma.metaConversionEvent.findUnique({ where: { eventId: context.eventId } });
    if (!raced) throw error;
    return { ...stateFor(raced.status), eventId: context.eventId };
  }
  return { ...stateFor("PENDING"), eventId: context.eventId };
}
