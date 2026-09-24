import "server-only";

import { normalizePhone } from "@/lib/auth/normalize";
import {
  createManualConversationFromFile,
  getConversationByIdFromFile,
  listConversationsForAudienceFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { prisma } from "@/lib/prisma";

export async function ensureSalesLeadConversation(input: {
  leadId: string;
  conversationId?: string | null;
  customerName: string;
  customerPhone: string;
  tenantId: string;
}) {
  const normalizedCustomerPhone = normalizePhone(input.customerPhone);
  if (!normalizedCustomerPhone) throw new Error("This lead does not have a valid WhatsApp number.");
  const existingConversationId = input.conversationId?.trim() || "";
  if (existingConversationId) {
    const existing = await getConversationByIdFromFile(existingConversationId);
    if (existing?.tenantId === input.tenantId && normalizePhone(existing.customerPhone) === normalizedCustomerPhone) return existing;
  }

  const inbox = await listConversationsForAudienceFromFile("sales", {
    tenantId: input.tenantId,
    includeSupportData: false,
  });
  const matchingConversation = inbox.conversations.find(
    (conversation) => normalizePhone(conversation.customerPhoneDisplay) === normalizedCustomerPhone,
  );
  const conversation =
    matchingConversation ??
    (
      await createManualConversationFromFile({
        role: "sales",
        tenantId: input.tenantId,
        customerName: input.customerName,
        customerPhone: normalizedCustomerPhone,
      })
    ).conversation;

  if (conversation.id !== existingConversationId) {
    await prisma.salesLeadAssignment.update({
      where: { id: input.leadId },
      data: { conversationId: conversation.id },
    });
  }

  return conversation;
}
