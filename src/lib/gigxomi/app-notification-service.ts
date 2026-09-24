import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { SessionUser } from "@/lib/auth/types";
import { prisma } from "@/lib/prisma";

import { listMobilePushTokens, sendMobilePushNotifications } from "@/lib/mobile-push-store";

type AuthorizedActor = Omit<SessionUser, "expiresAt" | "sessionId"> & Pick<SessionUser, "expiresAt" | "sessionId">;

function makeId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function resolveNotificationChannel(type: string): string {
  const upper = (type || "").toUpperCase();
  if (upper.includes("CHAT") || upper.includes("MESSAGE")) {
    return "gigxomi-chat-messages-v2";
  }
  if (upper.includes("TASK") || upper.includes("ASSIGNMENT") || upper.includes("PROJECT") || upper.includes("OFFER")) {
    return "gigxomi-project-offers-v6";
  }
  if (upper.includes("DELIVERY") || upper.includes("REVIEW") || upper.includes("STATUS")) {
    return "gigxomi-status-updates";
  }
  if (upper.includes("PAYMENT") || upper.includes("PAYOUT") || upper.includes("WALLET") || upper.includes("ESCROW")) {
    return "gigxomi-payment-updates";
  }
  return "gigxomi-default";
}

function resolveNotificationDeepLink(input: {
  entityId?: string | null;
  entityType?: string | null;
  type: string;
}): string {
  const upper = (input.type || "").toUpperCase();
  const entityType = (input.entityType || "").toUpperCase();
  const entityId = input.entityId?.trim() || "";

  if (upper.includes("CHAT") || entityType === "CONVERSATION") {
    return entityId ? `/chat/${encodeURIComponent(entityId)}` : "/chats";
  }
  if (
    upper.includes("TEAM") ||
    entityType.includes("TEAM") ||
    upper === "FREELANCER_WORK_INTEREST" ||
    upper === "TEAM_APPLICATION_RECEIVED" ||
    entityType === "TEAM_REQUEST"
  ) {
    return "/team";
  }
  if (upper.includes("TASK") || upper.includes("ASSIGNMENT") || entityType === "TASK") {
    return entityId ? `/assignment/${encodeURIComponent(entityId)}` : "/projects";
  }
  if (upper.includes("DELIVERY") || upper.includes("REVIEW")) {
    return entityId ? `/assignment/${encodeURIComponent(entityId)}` : "/projects";
  }
  if (upper.includes("PAYMENT") || upper.includes("PAYOUT") || upper.includes("WALLET")) {
    return "/earnings";
  }
  return "/notifications";
}

function notificationTenantWhere(actor: AuthorizedActor) {
  const tenantId = actor.tenantId?.trim() || null;
  return tenantId ? { OR: [{ tenantId: null }, { tenantId }] } : { tenantId: null };
}

function isAppNotificationStoreMissing(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("appnotification") &&
    (message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("table") ||
      message.includes("p2021"))
  );
}

export async function createAppNotification(input: {
  entityId?: string | null;
  entityType?: string | null;
  message: string;
  metadata?: Prisma.InputJsonValue;
  tenantId?: string | null;
  title: string;
  type: string;
  userId?: string | null;
}) {
  const userId = input.userId?.trim();
  if (!userId) return null;

  try {
    const created = await prisma.appNotification.create({
      data: {
        id: makeId("notice"),
        userId,
        tenantId: input.tenantId?.trim() || null,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType?.trim() || null,
        entityId: input.entityId?.trim() || null,
        metadata: input.metadata ?? {},
        status: "UNREAD",
      },
    });

    // Dispatch FCM mobile push notification asynchronously
    void listMobilePushTokens({ activeOnly: true, userId })
      .then((tokens) => {
        if (!tokens.length) return;
        const channelId = resolveNotificationChannel(input.type);
        const deepLinkUrl = resolveNotificationDeepLink(input);
        return sendMobilePushNotifications(tokens, {
          title: input.title,
          body: input.message,
          data: {
            type: input.type,
            notificationId: created.id,
            entityType: input.entityType || "",
            entityId: input.entityId || "",
            deepLinkUrl,
            notificationChannelId: channelId,
          },
        });
      })
      .catch((err) => {
        console.warn("[app-notification] Failed to dispatch mobile push notification:", err);
      });

    return created;
  } catch (error) {
    if (isAppNotificationStoreMissing(error)) {
      return null;
    }
    throw error;
  }
}

export async function listNotificationsForActor(actor: AuthorizedActor) {
  try {
    const notifications = await prisma.appNotification.findMany({
      where: {
        userId: actor.userId,
        ...notificationTenantWhere(actor),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const unread = notifications.filter((item) => item.status === "UNREAD").length;
    return { ok: true as const, notifications, unread };
  } catch (error) {
    if (isAppNotificationStoreMissing(error)) {
      return { ok: true as const, notifications: [], unread: 0 };
    }
    throw error;
  }
}

export async function markNotificationRead(actor: AuthorizedActor, notificationId: string) {
  try {
    const notification = await prisma.appNotification.findFirst({
      where: {
        id: notificationId.trim(),
        ...notificationTenantWhere(actor),
      },
    });
    if (!notification) return { ok: false as const, status: 404, error: "Notification was not found." };
    if (notification.userId !== actor.userId && actor.role !== "SUPER_ADMIN") {
      return { ok: false as const, status: 403, error: "You do not have access to this notification." };
    }

    const updated = await prisma.appNotification.update({
      where: { id: notification.id },
      data: {
        status: "READ",
        readAt: new Date(),
      },
    });
    return { ok: true as const, notification: updated };
  } catch (error) {
    if (isAppNotificationStoreMissing(error)) {
      return { ok: false as const, status: 404, error: "Notification store is not ready yet." };
    }
    throw error;
  }
}
