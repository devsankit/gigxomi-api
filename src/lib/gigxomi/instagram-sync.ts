import "server-only";

import {
  getInstagramConnectionStateFromFile,
  ingestInstagramWebhookPayloadFromFile,
  getConversationByIdFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { publishConversationRealtimeEvent } from "@/lib/gigxomi/conversation-realtime";

type GraphMessage = {
  id: string;
  created_time: string;
  from?: { id: string; username: string };
  to?: { data: Array<{ id: string; username: string }> };
  message?: string;
};

type GraphConversation = {
  id: string;
  updated_time: string;
  participants?: { data: Array<{ id: string; username: string }> };
};

export async function syncInstagramConversationsForTenant(tenantId: string) {
  const connection = await getInstagramConnectionStateFromFile(tenantId);
  if (!connection) {
    return { ok: false, error: "No Instagram connection found for this tenant." };
  }

  const token = connection.accessToken?.trim();
  if (!token) {
    return { ok: false, error: "No Instagram access token is configured." };
  }

  const businessAccountId = String(
    connection.instagramBusinessAccountId || connection.accountId || "27543502251911722",
  ).trim();
  const username = connection.username || "gigxomi";

  const convsUrl = `https://graph.instagram.com/v25.0/me/conversations?fields=id,updated_time,participants&limit=50&access_token=${encodeURIComponent(
    token,
  )}`;

  let convsData: { data?: GraphConversation[]; error?: { message?: string } } = {};
  try {
    const res = await fetch(convsUrl, { cache: "no-store" });
    convsData = (await res.json()) as typeof convsData;
    if (!res.ok || !convsData.data) {
      return { ok: false, error: convsData.error?.message || "Failed to fetch conversations from Instagram." };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to connect to Instagram Graph API." };
  }

  const threads = convsData.data ?? [];
  let totalMessages = 0;
  const conversationsTouched = new Set<string>();

  for (const thread of threads) {
    const participants = thread.participants?.data ?? [];
    const other = participants.find((p) => p.username !== username && p.id !== businessAccountId) || participants[0];
    const customerScopedUserId = other?.id;
    if (!customerScopedUserId) continue;

    let rawMsgs: GraphMessage[] = [];
    try {
      const msgUrl = `https://graph.instagram.com/v25.0/${thread.id}/messages?fields=id,created_time,from,to,message&limit=50&access_token=${encodeURIComponent(
        token,
      )}`;
      const msgRes = await fetch(msgUrl, { cache: "no-store" });
      const msgData = (await msgRes.json()) as { data?: GraphMessage[] };
      rawMsgs = msgData.data ?? [];
    } catch {
      continue;
    }

    if (!rawMsgs.length) continue;

    // Sort messages chronologically (oldest first) so they append in proper order
    const sorted = [...rawMsgs].sort(
      (a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime(),
    );

    const customerUsername = other?.username ? (other.username.startsWith("@") ? other.username : `@${other.username}`) : undefined;

    const messagingEvents = sorted
      .filter((m) => Boolean(m.message && m.message.trim()))
      .map((m) => {
        const isEcho = m.from?.id === businessAccountId || m.from?.username === username;
        return {
          sender: {
            id: isEcho ? businessAccountId : customerScopedUserId,
            username: isEcho ? username : other?.username,
          },
          recipient: {
            id: isEcho ? customerScopedUserId : businessAccountId,
            username: isEcho ? other?.username : username,
          },
          customerName: customerUsername,
          timestamp: new Date(m.created_time).getTime(),
          message: {
            mid: m.id,
            text: m.message!.trim(),
            is_echo: isEcho,
          },
        };
      });

    if (!messagingEvents.length) continue;

    const payload = {
      object: "instagram",
      entry: [
        {
          id: businessAccountId,
          time: Date.now(),
          messaging: messagingEvents,
        },
      ],
    };

    const ingestResult = await ingestInstagramWebhookPayloadFromFile(payload, { tenantId });
    totalMessages += ingestResult.processedMessages;
    for (const cId of ingestResult.conversationsTouched) {
      conversationsTouched.add(cId);
    }
  }

  // Publish realtime events so active inboxes immediately see the threads
  await Promise.allSettled(
    Array.from(conversationsTouched).map(async (conversationId) => {
      const conv = await getConversationByIdFromFile(conversationId);
      await publishConversationRealtimeEvent({
        conversationId,
        eventType: "message-created",
        tenantId: conv?.tenantId ?? tenantId,
        userIds: conv?.assignedFreelancerId ? [conv.assignedFreelancerId] : [],
      });
    }),
  );

  return {
    ok: true,
    threadsCount: threads.length,
    processedMessages: totalMessages,
    conversationsTouched: Array.from(conversationsTouched),
  };
}
