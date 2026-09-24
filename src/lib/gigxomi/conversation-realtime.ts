import "server-only";

import { EventEmitter } from "node:events";

import { listRealtimeEvents, persistRealtimeEvent } from "@/lib/realtime/event-outbox";

export type ConversationRealtimeSession = {
  role: string;
  tenantId?: string | null;
  userId: string;
  editorId?: string | null;
  candidateEditorIds?: string[] | null;
};

export type ConversationRealtimeEvent = {
  conversationId: string;
  createdAt: string;
  eventType: "conversation-updated" | "message-created" | "conversation-read";
  tenantId?: string | null;
  userIds?: string[];
  visibility?: "client_private" | "default" | string | null;
};

const CONVERSATION_REALTIME_TOPIC = "chat.conversations";

const globalForConversationRealtime = globalThis as typeof globalThis & {
  __gigxomiConversationEmitter?: EventEmitter;
};

function getEmitter() {
  if (!globalForConversationRealtime.__gigxomiConversationEmitter) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(500);
    globalForConversationRealtime.__gigxomiConversationEmitter = emitter;
  }

  return globalForConversationRealtime.__gigxomiConversationEmitter;
}

function normalizeUserIds(userIds?: Array<string | null | undefined>) {
  return Array.from(new Set((userIds ?? []).map((userId) => userId?.trim()).filter(Boolean) as string[]));
}

export function resolveConversationRealtimeRecipients(
  conversation: {
    assignedFreelancerId?: string | null;
    freelancerCollaborators?: Array<{ freelancerId: string; freelancerName?: string }>;
    tenantId?: string | null;
  },
  message?: {
    visibility?: string | null;
    lane?: string | null;
  } | null,
): string[] {
  const isPrivate = String(message?.visibility ?? "").trim().toLowerCase() === "client_private";
  if (isPrivate) {
    return [];
  }

  const recipients = new Set<string>();
  const primaryId = conversation?.assignedFreelancerId?.trim();
  if (primaryId) {
    recipients.add(primaryId);
  }

  for (const collab of conversation?.freelancerCollaborators ?? []) {
    const collabId = collab?.freelancerId?.trim();
    if (collabId) {
      recipients.add(collabId);
    }
  }

  return Array.from(recipients);
}

export async function publishConversationRealtimeEvent(
  event: Omit<ConversationRealtimeEvent, "createdAt"> & { createdAt?: string },
) {
  const isPrivate = String(event.visibility ?? "").trim().toLowerCase() === "client_private";
  const normalizedEvent: ConversationRealtimeEvent = {
    ...event,
    createdAt: event.createdAt ?? new Date().toISOString(),
    userIds: isPrivate ? [] : normalizeUserIds(event.userIds),
  };

  await persistRealtimeEvent({
    audienceUserIds: normalizedEvent.userIds,
    audienceRoles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"],
    eventType: normalizedEvent.eventType,
    payload: normalizedEvent,
    tenantId: normalizedEvent.tenantId ?? null,
    topic: CONVERSATION_REALTIME_TOPIC,
  }).catch(() => {
    // Keep live in-process events working during deploys where the durable outbox is unavailable.
  });

  getEmitter().emit("conversation", normalizedEvent);
  return normalizedEvent;
}

export function subscribeConversationRealtimeEvents(listener: (event: ConversationRealtimeEvent) => void) {
  const emitter = getEmitter();
  emitter.on("conversation", listener);
  return () => emitter.off("conversation", listener);
}

export function canReceiveConversationRealtimeEvent(
  event: ConversationRealtimeEvent,
  session: ConversationRealtimeSession,
): boolean {
  // Priority 1: SUPER_ADMIN always receives all events across all tenants
  if (session.role === "SUPER_ADMIN") {
    return true;
  }

  // Priority 2: Freelancers NEVER receive private message events
  const isPrivate = String(event.visibility ?? "").trim().toLowerCase() === "client_private";
  if (isPrivate && session.role === "FREELANCER") {
    return false;
  }

  // Priority 3b: Sales agents receive events for shared sales pool
  if (session.role === "SALES_AGENT") {
    const isSalesPool =
      !event.tenantId ||
      event.tenantId === session.tenantId ||
      event.tenantId === "tenant-agency-408de269" ||
      event.tenantId === "tenant-gigxomi" ||
      event.tenantId.startsWith("tenant-gigxomi-sales-agent-");
    if (isSalesPool) {
      return true;
    }
  }

  // Priority 3: Agency staff (ADMIN, MANAGER) in matching tenantId receive events
  const isAgencyStaff = Boolean(
    event.tenantId &&
      session.tenantId &&
      event.tenantId === session.tenantId &&
      (session.role === "ADMIN" || session.role === "MANAGER"),
  );
  if (isAgencyStaff) {
    return true;
  }

  // Priority 4: Targeted recipients matching session identities (userId, editorId, candidateEditorIds)
  const targetUserIds = normalizeUserIds(event.userIds);
  if (targetUserIds.length) {
    const sessionIdentities = [
      session.userId,
      session.editorId,
      ...(session.candidateEditorIds ?? []),
    ].filter((id): id is string => Boolean(id?.trim()));

    return sessionIdentities.some((identity) => targetUserIds.includes(identity));
  }

  // Priority 5: Fallback requires session.role !== "FREELANCER" and matching tenantId
  return Boolean(
    session.role !== "FREELANCER" &&
      event.tenantId &&
      session.tenantId &&
      event.tenantId === session.tenantId,
  );
}

export async function listRecentConversationRealtimeEvents(session: ConversationRealtimeSession) {
  const rows = await listRealtimeEvents<ConversationRealtimeEvent>({
    limit: 40,
    topic: CONVERSATION_REALTIME_TOPIC,
  }).catch(() => []);

  return rows.map((row) => row.payload).filter((event) => canReceiveConversationRealtimeEvent(event, session));
}
