import "server-only";

import {
  isConversationMessageIncomingForAudience,
  type SharedChatAudience,
} from "@/lib/gigxomi/chat-message-normalization";
import { getConversationByIdFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { listMobilePushTokens, sendMobilePushNotifications } from "@/lib/mobile-push-store";
import { prisma } from "@/lib/prisma";

type SendMobileChatPushInput = {
  conversationId: string;
  messageBody?: string;
  messageId?: string;
  lane?: "customer" | "internal";
  projectId?: string;
  senderId?: string;
  senderRole?: string;
};

function getLatestMessage(conversation: NonNullable<Awaited<ReturnType<typeof getConversationByIdFromFile>>>) {
  return [...(conversation.messages ?? [])].sort((left, right) => {
    const leftTime = new Date(left.createdAt ?? "").getTime();
    const rightTime = new Date(right.createdAt ?? "").getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  })[0];
}

function getNotificationBody(input: SendMobileChatPushInput) {
  return input.messageBody?.trim() || "New message - reply or open Gigxomi to view.";
}

function getConversationPushTitle(conversation: NonNullable<Awaited<ReturnType<typeof getConversationByIdFromFile>>>) {
  return conversation.customerName?.trim() || conversation.serviceTitle?.trim() || "Gigxomi message";
}

function getAudienceForTokenRole(role?: string): SharedChatAudience {
  const normalizedRole = String(role ?? "").trim().toUpperCase();
  if (normalizedRole === "CUSTOMER") return "customer";
  if (normalizedRole === "FREELANCER" || normalizedRole === "EDITOR") return "freelancer";
  if (normalizedRole === "MANAGER" || normalizedRole === "OPERATIONS") return "manager";
  if (normalizedRole === "SALES_AGENT") return "sales";
  return "admin";
}

export async function sendMobileChatPushForConversation(input: SendMobileChatPushInput) {
  const conversation = await getConversationByIdFromFile(input.conversationId);
  if (!conversation) {
    console.warn("Mobile chat push skipped: conversation missing", {
      conversationId: input.conversationId,
    });
    return { sent: 0, skipped: "conversation_missing" as const };
  }

  const latestMessage = getLatestMessage(conversation);
  const notificationMessage =
    (input.messageId ? conversation.messages?.find((message) => message.id === input.messageId) : null) ?? latestMessage;
  if (!notificationMessage) {
    return { sent: 0, skipped: "message_missing" as const };
  }
  const [activeTokens, salesAssignments] = await Promise.all([
    listMobilePushTokens({ activeOnly: true }),
    prisma.salesLeadAssignment.findMany({
      where: { conversationId: input.conversationId },
      select: { assignedAgent: { select: { userId: true } }, id: true },
    }),
  ]);
  const salesLeadIdByUserId = new Map(salesAssignments.map((assignment) => [assignment.assignedAgent.userId, assignment.id]));
  const receiverTokens = activeTokens.filter((record) => {
    if (input.senderId && record.userId === input.senderId) {
      return false;
    }

    const receiverAudience = getAudienceForTokenRole(record.role);
    if (!isConversationMessageIncomingForAudience(notificationMessage, receiverAudience)) {
      return false;
    }

    // CRM device tokens intentionally use a per-agent WhatsApp tenant. Route
    // sales chat by the assigned lead instead of the conversation's agency
    // tenant, which prevents both missed alerts and cross-agent disclosure.
    if (receiverAudience === "sales") {
      return salesLeadIdByUserId.has(record.userId);
    }

    if (receiverAudience !== "freelancer" && receiverAudience !== "sales") {
      if (record.tenantId && conversation.tenantId && record.tenantId !== conversation.tenantId) {
        return false;
      }
    }

    const isPrivate = String(notificationMessage.visibility ?? "").trim().toLowerCase() === "client_private";

    if (receiverAudience === "customer") {
      if (isPrivate) {
        return false;
      }
      return Boolean(conversation.isInAppCustomerThread && conversation.customerId && record.userId === conversation.customerId);
    }

    if (receiverAudience === "freelancer") {
      const assignedFreelancerId = conversation.assignedFreelancerId?.trim();
      const isCollaborator = (conversation.freelancerCollaborators ?? []).some(
        (c) => c && c.freelancerId === record.userId,
      );
      if (!assignedFreelancerId || (record.userId !== assignedFreelancerId && !isCollaborator)) {
        return false;
      }

      if (isPrivate) {
        return false;
      }

      if (
        notificationMessage.lane === "customer" &&
        notificationMessage.senderRole !== "freelancer" &&
        !conversation.freelancerCustomerLaneAccess
      ) {
        return false;
      }
    }

    return true;
  });

  if (!receiverTokens.length) {
    console.warn("Mobile chat push skipped: no receiver tokens", {
      activeTokenCount: activeTokens.length,
      assignedFreelancerId: conversation.assignedFreelancerId || null,
      conversationId: input.conversationId,
      conversationTenantId: conversation.tenantId || null,
      latestMessageLane: notificationMessage.lane || null,
      senderId: input.senderId || null,
    });
    return { sent: 0, skipped: "no_receiver_tokens" as const };
  }

  const result = await sendMobilePushNotifications(receiverTokens, {
    title: getConversationPushTitle(conversation),
    body: getNotificationBody({ ...input, messageBody: input.messageBody || notificationMessage.body }),
    data: {
      body: getNotificationBody({ ...input, messageBody: input.messageBody || notificationMessage.body }),
      conversationId: input.conversationId,
      conversationAvatarUrl: conversation.customerProfileImageUrl || "",
      conversationTitle: getConversationPushTitle(conversation),
      chatId: input.conversationId,
      leadId: "",
      messageId: input.messageId || notificationMessage.id || "",
      lane: input.lane || notificationMessage.lane || "",
      notificationChannelId: "gigxomi-chat-messages-v2",
      projectId: input.projectId || "",
      senderName: notificationMessage.senderLabel || "Gigxomi",
      senderId: input.senderId || input.senderRole || "external",
      type: "chat",
    },
    dataForRecord: (record) => ({
      audience: getAudienceForTokenRole(record.role),
      leadId: salesLeadIdByUserId.get(record.userId) ?? "",
      receiverId: record.userId,
    }),
  });
  console.info("Mobile chat push dispatch finished", {
    attempted: result.attempted,
    conversationId: input.conversationId,
    failed: result.failed,
    receiverTokenCount: receiverTokens.length,
    sent: result.sent,
  });
  return result;
}
