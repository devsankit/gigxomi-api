import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listMobilePushTokens } from "@/lib/mobile-push-store";
import { prisma } from "@/lib/prisma";

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "Instant";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ${min % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const { userId } = await context.params;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "User ID is required." }, { status: 400 });
  }

  try {
    const [user, rawTokens, rawNotifications, rawDrips] = await Promise.all([
      prisma.appAuthUser.findUnique({
        where: { id: userId },
        select: {
          id: true,
          displayName: true,
          phone: true,
          email: true,
          role: true,
          workspaceMode: true,
          tenantId: true,
          createdAt: true,
        },
      }),
      listMobilePushTokens({ userId }).catch(() => []),
      prisma.appNotification.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }, // Ascending for chronological interval computation
      }),
      prisma.appDripDelivery.findMany({
        where: { userId },
        include: {
          campaign: { select: { id: true, name: true, trigger: true, destination: true } },
        },
        orderBy: { scheduledAt: "desc" },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
    }

    // Compute intervals and time-to-read
    const processedNotifications = rawNotifications.map((item, index) => {
      let intervalMs = 0;
      let intervalFormatted = "Initial notification";

      if (index > 0) {
        const prevTime = rawNotifications[index - 1].createdAt.getTime();
        const currTime = item.createdAt.getTime();
        intervalMs = Math.max(0, currTime - prevTime);
        intervalFormatted = `+${formatDuration(intervalMs)} after previous`;
      }

      let timeToReadMs: number | null = null;
      let timeToReadFormatted = "Unread";

      if (item.status === "READ" && item.readAt) {
        timeToReadMs = Math.max(0, item.readAt.getTime() - item.createdAt.getTime());
        timeToReadFormatted = `Read in ${formatDuration(timeToReadMs)}`;
      }

      return {
        id: item.id,
        type: item.type,
        title: item.title,
        message: item.message,
        entityType: item.entityType,
        entityId: item.entityId,
        status: item.status,
        metadata: item.metadata,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
        intervalMs,
        intervalFormatted,
        timeToReadMs,
        timeToReadFormatted,
      };
    });

    // Summary calculations
    const totalReceived = processedNotifications.length;
    const readCount = processedNotifications.filter((n) => n.status === "READ").length;
    const unreadCount = totalReceived - readCount;
    const readRatePercent =
      totalReceived > 0 ? Math.round((readCount / totalReceived) * 1000) / 10 : 0;

    // Average interval
    let avgIntervalMs = 0;
    if (processedNotifications.length > 1) {
      const firstTime = rawNotifications[0].createdAt.getTime();
      const lastTime = rawNotifications[rawNotifications.length - 1].createdAt.getTime();
      avgIntervalMs = Math.round((lastTime - firstTime) / (processedNotifications.length - 1));
    }

    // Average time to read
    const readItemsWithTimes = processedNotifications.filter(
      (n) => n.timeToReadMs !== null && n.timeToReadMs >= 0,
    );
    let avgTimeToReadMs = 0;
    if (readItemsWithTimes.length > 0) {
      avgTimeToReadMs = Math.round(
        readItemsWithTimes.reduce((acc, curr) => acc + (curr.timeToReadMs ?? 0), 0) /
          readItemsWithTimes.length,
      );
    }

    // Return timeline descending (most recent first) for UI display
    const timeline = [...processedNotifications].reverse();

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        displayName: user.displayName,
        phone: user.phone,
        email: user.email,
        role: user.role,
        workspaceMode: user.workspaceMode,
        tenantId: user.tenantId,
        createdAt: user.createdAt.toISOString(),
      },
      stats: {
        totalReceived,
        readCount,
        unreadCount,
        readRatePercent,
        avgIntervalMs,
        avgIntervalFormatted: formatDuration(avgIntervalMs),
        avgTimeToReadMs,
        avgTimeToReadFormatted: formatDuration(avgTimeToReadMs),
        firstNotificationAt: rawNotifications[0]?.createdAt.toISOString() ?? null,
        lastNotificationAt:
          rawNotifications[rawNotifications.length - 1]?.createdAt.toISOString() ?? null,
      },
      deviceTokens: rawTokens.map((t) => ({
        id: t.id,
        platform: t.platform,
        isActive: !t.disabledAt,
        tokenPreview: `${t.token.slice(0, 14)}...${t.token.slice(-6)}`,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        lastSeenAt: t.updatedAt,
      })),
      dripDeliveries: rawDrips.map((d) => ({
        id: d.id,
        campaignName: d.campaign?.name || "Drip Campaign",
        trigger: d.campaign?.trigger || "CUSTOM",
        status: d.status,
        scheduledAt: d.scheduledAt.toISOString(),
        sentAt: d.sentAt?.toISOString() ?? null,
        failedAt: d.failedAt?.toISOString() ?? null,
        error: d.error,
        triggerKey: d.triggerKey,
      })),
      timeline,
    });
  } catch (error) {
    console.error("[user-push-timeline-api] Error loading user notifications:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load user notifications." },
      { status: 500 },
    );
  }
}
