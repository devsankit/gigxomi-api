import "server-only";

import {
  listMobilePushTokens,
  sendMobilePushNotifications,
} from "@/lib/mobile-push-store";

type AssignmentPushPayload = {
  assignmentId: string;
  conversationId: string;
  deepLinkUrl: string;
  title: string;
  body: string;
  baseUrl?: string;
  eventType?: "ASSIGNMENT_NEW" | "ASSIGNMENT_MISSED";
  expiresAt?: string;
};

type InboundMessagePushPayload = {
  conversationId: string;
  deepLinkUrl: string;
  title: string;
  body: string;
  baseUrl?: string;
};

type AssignmentStatusPushPayload = {
  assignmentId: string;
  conversationId: string;
  deepLinkUrl: string;
  title: string;
  body: string;
  baseUrl?: string;
};

type AssignmentPushDispatchSummary = {
  assignmentId: string;
  attempted: number;
  conversationId: string;
  failed: number;
  recordedAt: string;
  sent: number;
  status: "failed" | "no_active_token" | "sent";
  userId: string;
};

let lastAssignmentPushDispatchSummary: AssignmentPushDispatchSummary | null = null;

export function getLastAssignmentPushDispatchSummary() {
  return lastAssignmentPushDispatchSummary;
}

export function getRequestOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (host) {
    const proto = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

function resolveNotificationLink(link: string, baseUrl?: string) {
  const raw = String(link || "").trim() || "/chat";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }

  const base =
    baseUrl?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    "https://gigxomi.com";

  try {
    return new URL(raw.startsWith("/") ? raw : `/${raw}`, base).toString();
  } catch {
    return "https://gigxomi.com/chat";
  }
}

export async function sendAssignmentPushToUser(input: {
  userId: string;
  payload: AssignmentPushPayload;
}) {
  const link = resolveNotificationLink(input.payload.deepLinkUrl, input.payload.baseUrl);
  const tokens = await listMobilePushTokens({ activeOnly: true, userId: input.userId });

  if (!tokens.length) {
    lastAssignmentPushDispatchSummary = {
      assignmentId: input.payload.assignmentId,
      attempted: 0,
      conversationId: input.payload.conversationId,
      failed: 0,
      recordedAt: new Date().toISOString(),
      sent: 0,
      status: "no_active_token",
      userId: input.userId,
    };
    console.warn("Assignment push skipped: target user has no active FCM token", {
      assignmentId: input.payload.assignmentId,
      conversationId: input.payload.conversationId,
      userId: input.userId,
    });
    return { ok: true, attempted: 0, failed: 0, sent: 0, status: "no_active_token" as const };
  }

  const result = await sendMobilePushNotifications(tokens, {
    dataForRecord: (record) => ({
      notificationChannelId: record.projectOfferChannelId || "gigxomi-project-offers-v4",
    }),
    title: input.payload.title,
    body: input.payload.body,
    data: {
      type: input.payload.eventType ?? "ASSIGNMENT_NEW",
      assignmentId: input.payload.assignmentId,
      conversationId: input.payload.conversationId,
      deepLinkUrl: link,
      expiresAt: input.payload.expiresAt ?? "",
      notificationChannelId: "gigxomi-project-offers-v4",
      notificationCategoryId: "gigxomi-project-offer",
    },
  });

  lastAssignmentPushDispatchSummary = {
    assignmentId: input.payload.assignmentId,
    attempted: result.attempted,
    conversationId: input.payload.conversationId,
    failed: result.failed,
    recordedAt: new Date().toISOString(),
    sent: result.sent,
    status: result.sent > 0 ? "sent" : "failed",
    userId: input.userId,
  };

  console.info("Assignment push dispatch finished", {
    assignmentId: input.payload.assignmentId,
    attempted: result.attempted,
    conversationId: input.payload.conversationId,
    failed: result.failed,
    sent: result.sent,
    userId: input.userId,
  });

  return {
    ok: true,
    attempted: result.attempted,
    failed: result.failed,
    sent: result.sent,
    status: result.sent > 0 ? ("sent" as const) : ("failed" as const),
  };
}

export async function sendInboundMessagePushToUser(input: {
  userId: string;
  payload: InboundMessagePushPayload;
}) {
  const link = resolveNotificationLink(input.payload.deepLinkUrl, input.payload.baseUrl);
  const tokens = await listMobilePushTokens({ activeOnly: true, userId: input.userId });

  if (!tokens.length) {
    return { ok: true, sent: 0 } as const;
  }

  const result = await sendMobilePushNotifications(tokens, {
    title: input.payload.title,
    body: input.payload.body,
    data: {
      type: "CHAT_NEW_MESSAGE",
      conversationId: input.payload.conversationId,
      deepLinkUrl: link,
      notificationChannelId: "gigxomi-chat-live",
    },
  });

  return { ok: true, sent: result.sent } as const;
}

export async function sendAssignmentStatusPushToUser(input: {
  userId: string;
  payload: AssignmentStatusPushPayload;
}) {
  const link = resolveNotificationLink(input.payload.deepLinkUrl, input.payload.baseUrl);
  const tokens = await listMobilePushTokens({ activeOnly: true, userId: input.userId });

  if (!tokens.length) {
    return { ok: true, attempted: 0, failed: 0, sent: 0, status: "no_active_token" as const };
  }

  const result = await sendMobilePushNotifications(tokens, {
    androidDataOnly: true,
    title: input.payload.title,
    body: input.payload.body,
    data: {
      type: "ASSIGNMENT_MISSED",
      assignmentId: input.payload.assignmentId,
      conversationId: input.payload.conversationId,
      deepLinkUrl: link,
      notificationChannelId: "gigxomi-status-updates",
    },
  });

  return {
    ok: true,
    attempted: result.attempted,
    failed: result.failed,
    sent: result.sent,
    status: result.sent > 0 ? ("sent" as const) : ("failed" as const),
  };
}
