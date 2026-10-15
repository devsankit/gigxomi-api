import "server-only";

import { prisma } from "@/lib/prisma";

function normalizeConversationPhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export async function syncTouchedWhatsAppConversations(conversationIds: string[]) {
  if (!Array.isArray(conversationIds) || !conversationIds.length) return;
  const uniqueIds = Array.from(new Set(conversationIds.filter(Boolean)));
  if (!uniqueIds.length) return;

  try {
    const [conversations, activeAgents] = await Promise.all([
      prisma.appConversation.findMany({
        where: {
          id: { in: uniqueIds },
          OR: [
            { tenantId: "tenant-gigxomi" },
            { tenantId: { startsWith: "tenant-gigxomi-sales-agent-" } },
          ],
        },
        select: {
          id: true,
          customerName: true,
          customerPhone: true,
          leadStatusId: true,
          payload: true,
          updatedAt: true,
        },
      }),
      prisma.salesAgentProfile.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, canClaimLeads: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    if (!conversations.length) return;
    const fallbackAgentId = activeAgents.find((a) => a.canClaimLeads)?.id || activeAgents[0]?.id;
    if (!fallbackAgentId) return;

    for (const conv of conversations) {
      const phoneDigits = normalizeConversationPhone(conv.customerPhone);
      const existing = await prisma.salesLeadAssignment.findFirst({
        where: {
          OR: [
            { conversationId: conv.id },
            ...(phoneDigits ? [{ customerPhone: { contains: phoneDigits } }] : []),
          ],
        },
      });

      if (existing) {
        const mergedTags = Array.from(new Set([...(existing.tags || []), "digital_franchise_lead", "source_ai_bot"]));
        await prisma.salesLeadAssignment.update({
          where: { id: existing.id },
          data: {
            conversationId: conv.id,
            customerName: conv.customerName || existing.customerName,
            customerPhone: conv.customerPhone || existing.customerPhone,
            tags: mergedTags,
            lastContactedAt: conv.updatedAt,
            updatedAt: conv.updatedAt,
          },
        });
      } else {
        await prisma.salesLeadAssignment.create({
          data: {
            id: `sales-conversation-${conv.id}`,
            assignedAgentId: fallbackAgentId,
            customerName: conv.customerName || "Franchise Lead",
            customerPhone: conv.customerPhone || null,
            source: "FRANCHISE_AI_BOT",
            serviceInterest: "Gigxomi Digital Franchise Territory",
            segment: "franchise_partner",
            priority: "hot",
            tags: ["digital_franchise_lead", "territory_checked", "source_ai_bot"],
            conversationId: conv.id,
            budgetAmount: 0,
            stage: "NEW",
            notes: "Inbound WhatsApp franchise conversation automatically synced to Closer CRM.",
            lastContactedAt: conv.updatedAt,
            createdAt: conv.updatedAt,
            updatedAt: conv.updatedAt,
          },
        });
      }
    }
  } catch (error) {
    console.warn("[whatsapp-sales-lead-sync] Failed to sync touched conversations:", error);
  }
}
