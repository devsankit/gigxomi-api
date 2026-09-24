import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listMobilePushTokens } from "@/lib/mobile-push-store";
import { prisma } from "@/lib/prisma";

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "Instant";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ${min % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  try {
    const [
      totalNotifications,
      readNotifications,
      readSamples,
      deviceTokens,
      campaigns,
      dripDeliveries,
      rawUsers,
    ] = await Promise.all([
      prisma.appNotification.count().catch(() => 0),
      prisma.appNotification.count({ where: { status: "READ" } }).catch(() => 0),
      prisma.appNotification
        .findMany({
          where: { status: "READ", readAt: { not: null } },
          select: { createdAt: true, readAt: true },
          take: 100,
          orderBy: { createdAt: "desc" },
        })
        .catch(() => []),
      listMobilePushTokens({ activeOnly: true }).catch(() => []),
      prisma.appDripCampaign
        .findMany({
          include: { _count: { select: { deliveries: true } } },
          orderBy: { createdAt: "asc" },
        })
        .catch(() => []),
      prisma.appDripDelivery
        .findMany({
          take: 30,
          orderBy: { scheduledAt: "desc" },
          include: {
            campaign: { select: { id: true, name: true, trigger: true } },
            user: { select: { id: true, displayName: true, phone: true, role: true } },
          },
        })
        .catch(() => []),
      // Priority users who have notifications or tokens
      prisma.appNotification
        .groupBy({
          by: ["userId"],
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 50,
        })
        .then(async (groups) => {
          const priorityIds = groups.map((g) => g.userId);
          const [topUsers, recentUsers] = await Promise.all([
            prisma.appAuthUser.findMany({
              where: { id: { in: priorityIds } },
              select: {
                id: true,
                displayName: true,
                phone: true,
                email: true,
                role: true,
                workspaceMode: true,
                createdAt: true,
                dripDeliveries: { select: { id: true } },
              },
            }),
            prisma.appAuthUser.findMany({
              where: { id: { notIn: priorityIds } },
              take: 50,
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                displayName: true,
                phone: true,
                email: true,
                role: true,
                workspaceMode: true,
                createdAt: true,
                dripDeliveries: { select: { id: true } },
              },
            }),
          ]);
          return [...topUsers, ...recentUsers];
        })
        .catch(() => []),
    ]);

    // Calculate Average Time to Read
    let avgTimeToReadMs = 0;
    if (readSamples.length > 0) {
      const validDeltas = readSamples
        .filter((r) => r.readAt && r.createdAt && r.readAt.getTime() >= r.createdAt.getTime())
        .map((r) => (r.readAt as Date).getTime() - r.createdAt.getTime());

      if (validDeltas.length > 0) {
        avgTimeToReadMs = Math.round(
          validDeltas.reduce((acc, curr) => acc + curr, 0) / validDeltas.length,
        );
      }
    }

    // Token platforms breakdown using real active MobilePushTokens
    const userTokenCounts = new Map<string, number>();
    for (const t of deviceTokens) {
      userTokenCounts.set(t.userId, (userTokenCounts.get(t.userId) || 0) + 1);
    }

    const platformBreakdown = {
      total: deviceTokens.length,
      android: deviceTokens.filter((t) => t.platform === "android").length,
      ios: deviceTokens.filter((t) => t.platform === "ios").length,
      web: deviceTokens.filter((t) => t.platform === "web").length,
      uniqueUsers: userTokenCounts.size,
    };

    // Drip delivery summary
    const dripStats = {
      total: dripDeliveries.length,
      sent: dripDeliveries.filter((d) => d.status === "SENT").length,
      pending: dripDeliveries.filter((d) => d.status === "PENDING").length,
      failed: dripDeliveries.filter((d) => d.status === "FAILED").length,
      skipped: dripDeliveries.filter((d) => d.status === "SKIPPED").length,
    };

    const unreadNotifications = Math.max(0, totalNotifications - readNotifications);
    const readRatePercent =
      totalNotifications > 0
        ? Math.round((readNotifications / totalNotifications) * 1000) / 10
        : 0;

    return NextResponse.json({
      ok: true,
      stats: {
        totalNotifications,
        readNotifications,
        unreadNotifications,
        readRatePercent,
        avgTimeToReadMs,
        avgTimeToReadFormatted: formatDuration(avgTimeToReadMs),
        deviceTokens: platformBreakdown,
        dripStats,
      },
      campaigns,
      recentDripDeliveries: dripDeliveries.map((d) => ({
        id: d.id,
        campaignId: d.campaignId,
        campaignName: d.campaign?.name || "Drip Campaign",
        trigger: d.campaign?.trigger || "CUSTOM",
        userId: d.userId,
        userName: d.user?.displayName || "User",
        userPhone: d.user?.phone || "",
        userRole: d.user?.role || "FREELANCER",
        status: d.status,
        triggerKey: d.triggerKey,
        scheduledAt: d.scheduledAt.toISOString(),
        sentAt: d.sentAt?.toISOString() ?? null,
        failedAt: d.failedAt?.toISOString() ?? null,
        error: d.error,
        metadata: d.metadata,
      })),
      users: rawUsers.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        phone: u.phone,
        email: u.email,
        role: u.role,
        workspaceMode: u.workspaceMode,
        deviceTokenCount: userTokenCounts.get(u.id) || 0,
        dripDeliveriesCount: u.dripDeliveries?.length ?? 0,
      })),
    });
  } catch (error) {
    console.error("[push-overview-api] Failed to generate overview:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load push overview." },
      { status: 500 },
    );
  }
}
