import "server-only";

import type { AppRole as DbAppRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type MobilePushPlatform = "android" | "ios" | "web";
export type MobilePushAudienceRole = Extract<DbAppRole, "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "FREELANCER">;

export type MobilePushTokenRecord = {
  id: string;
  userId: string;
  token: string;
  platform: MobilePushPlatform;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

function normalizePlatform(value: string): MobilePushPlatform {
  if (value === "ios") return "ios";
  if (value === "web") return "web";
  return "android";
}

function toRecord(input: {
  id: string;
  userId: string;
  token: string;
  platform: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}): MobilePushTokenRecord {
  return {
    id: input.id,
    userId: input.userId,
    token: input.token,
    platform: normalizePlatform(input.platform),
    isActive: input.isActive,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
    lastSeenAt: input.lastSeenAt.toISOString(),
  };
}

export async function listActiveMobilePushUsersForAudience(input: {
  tenantId?: string | null;
  roles?: MobilePushAudienceRole[];
}) {
  const tenantId = input.tenantId?.trim() || undefined;
  const roles = input.roles?.filter(Boolean) ?? [];

  const rows = await prisma.devicePushToken.findMany({
    where: {
      isActive: true,
      user: {
        ...(tenantId ? { tenantId } : {}),
        ...(roles.length > 0 ? { role: { in: roles } } : {}),
      },
    },
    select: {
      userId: true,
      user: {
        select: {
          role: true,
          tenantId: true,
        },
      },
    },
    distinct: ["userId"],
  });

  return rows
    .map((row) => ({
      userId: row.userId.trim(),
      role: row.user.role as MobilePushAudienceRole,
      tenantId: row.user.tenantId,
    }))
    .filter((row) => row.userId);
}

export async function upsertMobilePushToken(input: {
  userId: string;
  token: string;
  platform: MobilePushPlatform;
}) {
  const userId = input.userId.trim();
  const token = input.token.trim();
  if (!userId || !token) {
    return null;
  }

  const now = new Date();
  const saved = await prisma.devicePushToken.upsert({
    where: { token },
    update: {
      userId,
      platform: input.platform,
      isActive: true,
      lastSeenAt: now,
    },
    create: {
      userId,
      token,
      platform: input.platform,
      isActive: true,
      lastSeenAt: now,
    },
  });

  return toRecord(saved);
}

export async function deactivateMobilePushToken(input: { userId: string; token: string }) {
  const userId = input.userId.trim();
  const token = input.token.trim();
  if (!userId || !token) {
    return false;
  }

  const result = await prisma.devicePushToken.updateMany({
    where: {
      userId,
      token,
      isActive: true,
    },
    data: {
      isActive: false,
    },
  });

  return result.count > 0;
}

export async function listActiveMobilePushTokensByUserId(userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return [] as MobilePushTokenRecord[];
  }

  const tokens = await prisma.devicePushToken.findMany({
    where: {
      userId: normalizedUserId,
      isActive: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return tokens.map(toRecord);
}

export async function listActiveMobilePushUserIds() {
  const rows = await prisma.devicePushToken.findMany({
    where: { isActive: true },
    select: { userId: true },
    distinct: ["userId"],
  });

  return rows
    .map((row) => row.userId.trim())
    .filter(Boolean);
}

export async function getActiveMobilePushTokenStats() {
  const rows = await prisma.devicePushToken.groupBy({
    by: ["platform"],
    where: { isActive: true },
    _count: {
      _all: true,
    },
  });

  const byPlatform: Record<MobilePushPlatform, number> = {
    android: 0,
    ios: 0,
    web: 0,
  };

  for (const row of rows) {
    const platform = normalizePlatform(row.platform);
    byPlatform[platform] = row._count._all;
  }

  const activeUsers = await prisma.devicePushToken.findMany({
    where: { isActive: true },
    select: { userId: true },
    distinct: ["userId"],
  });

  return {
    totalActiveTokens: byPlatform.android + byPlatform.ios + byPlatform.web,
    totalActiveUsers: activeUsers.length,
    byPlatform,
  };
}
