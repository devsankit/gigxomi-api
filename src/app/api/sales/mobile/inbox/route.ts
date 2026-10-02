import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getConversationById } from "@/lib/gigxomi/dummy-platform-store";
import { syncSalesAgentConversationLinks } from "@/lib/gigxomi/sales-store";
import { prisma } from "@/lib/prisma";

function getLatestMessagePreview(payload: unknown) {
  const messages = payload && typeof payload === "object" && Array.isArray((payload as { messages?: unknown[] }).messages)
    ? (payload as { messages: Array<{ body?: unknown; createdAt?: unknown }> }).messages
    : [];
  const latest = [...messages].sort((left, right) => new Date(String(right.createdAt ?? "")).getTime() - new Date(String(left.createdAt ?? "")).getTime())[0];
  return latest
    ? { body: typeof latest.body === "string" ? latest.body : "", createdAt: typeof latest.createdAt === "string" ? latest.createdAt : null }
    : null;
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SALES_AGENT", "SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor")?.trim() || "";
  const scope = url.searchParams.get("scope")?.trim() || "all";
  const agent = authorization.session.role === "SALES_AGENT"
    ? await prisma.salesAgentProfile.findUnique({ where: { userId: authorization.session.userId }, select: { id: true } })
    : null;
  if (authorization.session.role === "SALES_AGENT" && !agent) return NextResponse.json({ ok: false, error: "Sales profile was not found." }, { status: 403 });
  if (agent) await syncSalesAgentConversationLinks(agent.id);
  const leads = await prisma.salesLeadAssignment.findMany({
    where: {
      ...(agent && scope === "mine" ? { assignedAgentId: agent.id } : {}),
      conversationId: { not: null },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 31,
  });
  const page = leads.slice(0, 30);
  const conversations = await prisma.appConversation.findMany({ where: { id: { in: page.map((lead) => lead.conversationId).filter((value): value is string => Boolean(value)) } } });
  const byId = new Map(conversations.map((item) => [item.id, item]));
  return NextResponse.json({
    ok: true,
    conversations: page.map((lead) => {
      const conv = lead.conversationId ? byId.get(lead.conversationId) : null;
      let latestMessage = conv ? getLatestMessagePreview(conv.payload) : null;
      if (!latestMessage && lead.conversationId) {
        const fileConv = getConversationById(lead.conversationId);
        if (fileConv?.messages?.length) {
          const sorted = [...fileConv.messages].sort((left, right) => new Date(String(right.createdAt ?? "")).getTime() - new Date(String(left.createdAt ?? "")).getTime());
          if (sorted[0]) {
            latestMessage = { body: sorted[0].body ?? "", createdAt: sorted[0].createdAt ?? null };
          }
        }
      }
      return {
        lead: {
          id: lead.id,
          customerName: lead.customerName,
          customerPhone: lead.customerPhone,
          customerEmail: lead.customerEmail,
          stage: lead.stage,
          priority: lead.priority,
          serviceInterest: lead.serviceInterest,
          updatedAt: lead.updatedAt,
        },
        conversation: lead.conversationId
          ? {
              id: lead.conversationId,
              channel: "whatsapp",
              latestMessage,
              status: conv?.status ?? "OPEN",
              updatedAt: conv?.updatedAt ?? lead.updatedAt,
            }
          : null,
      };
    }),
    nextCursor: leads.length > 30 ? page[page.length - 1]?.id ?? null : null,
  });
}
