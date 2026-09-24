import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { deliverConversationMessageFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { ensureSalesLeadConversation } from "@/lib/gigxomi/sales-conversation-store";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send a valid WhatsApp message." }, { status: 400 });

  const leadId = String(body.leadId ?? "").trim();
  const message = String(body.message ?? "").trim();
  if (!leadId || !message) {
    return NextResponse.json({ ok: false, error: "Choose a CRM lead and write a message." }, { status: 400 });
  }

  const snapshot = await getSalesSnapshotForRole(authorization.session);
  const lead = snapshot.visibleLeads.find((item) => item.id === leadId);
  if (!lead) {
    return NextResponse.json({ ok: false, error: "You do not have access to this lead." }, { status: 403 });
  }
  if (!lead.customerPhone) {
    return NextResponse.json({ ok: false, error: "This lead does not have a WhatsApp number." }, { status: 400 });
  }

  const tenantId = resolveWhatsAppSetupTenantId(authorization.session);
  let conversation: Awaited<ReturnType<typeof ensureSalesLeadConversation>>;
  try {
    conversation = await ensureSalesLeadConversation({
      leadId: lead.id,
      conversationId: lead.conversationId,
      customerName: lead.customerName,
      customerPhone: lead.customerPhone,
      tenantId,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to create the WhatsApp chat." }, { status: 400 });
  }
  const result = await deliverConversationMessageFromFile(conversation.id, {
    role: "sales",
    lane: "customer",
    body: message,
  }).catch((error) => ({
    conversation,
    delivery: {
      ok: false as const,
      mode: "whatsapp-failed" as const,
      error: error instanceof Error ? error.message : "WhatsApp message failed",
    },
  }));
  const delivery = result?.delivery ?? { ok: false as const, mode: "whatsapp-failed" as const, error: "WhatsApp conversation was not found." };

  await prisma.salesLeadAssignment.update({
    where: { id: lead.id },
    data: {
      lastContactedAt: new Date(),
      activityLogs: {
        create: {
          actorUserId: authorization.session.userId,
          action: "WHATSAPP_MESSAGE_SENT",
          note: message.slice(0, 240),
          metadata: { delivery },
        },
      },
    },
  });

  return NextResponse.json({
    ok: delivery.ok,
    conversationId: conversation.id,
    delivery,
    error: delivery.ok ? undefined : "error" in delivery ? delivery.error : "WhatsApp message failed.",
  });
}
