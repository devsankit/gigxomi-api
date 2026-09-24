import "server-only";

import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type RealtimeEventRecord<TPayload = unknown> = {
  actorUserId: string | null;
  audienceRoles: string[];
  audienceUserIds: string[];
  createdAt: Date;
  eventType: string;
  id: string;
  payload: TPayload;
  tenantId: string | null;
  topic: string;
};

type PersistRealtimeEventInput = {
  actorUserId?: string | null;
  audienceRoles?: string[];
  audienceUserIds?: string[];
  eventType: string;
  payload: unknown;
  tenantId?: string | null;
  topic: string;
};

function makeEventId() {
  return `evt-${randomBytes(9).toString("hex")}`;
}

function normalizeTextArray(values?: string[]) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

export async function persistRealtimeEvent(input: PersistRealtimeEventInput) {
  const id = makeEventId();
  const audienceUserIds = normalizeTextArray(input.audienceUserIds);
  const audienceRoles = normalizeTextArray(input.audienceRoles);
  const payloadJson = JSON.stringify(input.payload ?? {});

  await prisma.$executeRaw`
    INSERT INTO "AppRealtimeEvent"
      ("id", "topic", "eventType", "tenantId", "actorUserId", "audienceUserIds", "audienceRoles", "payload")
    VALUES
      (
        ${id},
        ${input.topic},
        ${input.eventType},
        ${input.tenantId ?? null},
        ${input.actorUserId ?? null},
        ${audienceUserIds},
        ${audienceRoles},
        CAST(${payloadJson} AS JSONB)
      )
  `;

  return id;
}

export async function listRealtimeEvents<TPayload = unknown>(input: {
  limit?: number;
  since?: Date;
  topic: string;
}): Promise<RealtimeEventRecord<TPayload>[]> {
  const since = input.since ?? new Date(Date.now() - 10 * 60 * 1000);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const rows = await prisma.$queryRaw<
    Array<{
      actorUserId: string | null;
      audienceRoles: string[];
      audienceUserIds: string[];
      createdAt: Date;
      eventType: string;
      id: string;
      payload: Prisma.JsonValue;
      tenantId: string | null;
      topic: string;
    }>
  >`
    SELECT
      "id",
      "topic",
      "eventType",
      "tenantId",
      "actorUserId",
      "audienceUserIds",
      "audienceRoles",
      "payload",
      "createdAt"
    FROM "AppRealtimeEvent"
    WHERE "topic" = ${input.topic}
      AND "createdAt" > ${since}
    ORDER BY "createdAt" ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    ...row,
    payload: row.payload as TPayload,
  }));
}
