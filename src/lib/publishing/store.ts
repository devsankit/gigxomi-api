import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { PublishingDraftRecord, PublishingMode, PublishingStructuredDraft } from "@/lib/publishing/types";
import { defaultPublishingStructuredDraft } from "@/lib/publishing/types";

function nextId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function toIsoDate(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toMessageArray(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value : [];
}

function toSuggestedValues(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string[]>) : {};
}

function toJsonString(value: unknown) {
  return JSON.stringify(value ?? null);
}

function toDraftRecord(record: {
  id: string;
  ownerId: string;
  ownerDisplayName: string;
  mode: string;
  status: string;
  linkedEntityId: string | null;
  currentStep: string | null;
  missingFields: string[];
  payload: Prisma.JsonValue;
  rawMessages: Prisma.JsonValue;
  lastSuggestedValues: Prisma.JsonValue;
  createdAt: Date | string;
  updatedAt: Date | string;
}) {
  return {
    id: record.id,
    ownerId: record.ownerId,
    ownerDisplayName: record.ownerDisplayName,
    mode: record.mode as PublishingMode,
    status: record.status as PublishingDraftRecord["status"],
    linkedEntityId: record.linkedEntityId,
    currentStep: (record.currentStep as PublishingDraftRecord["currentStep"]) ?? null,
    missingFields: record.missingFields as PublishingDraftRecord["missingFields"],
    payload: record.payload as PublishingStructuredDraft,
    rawMessages: toMessageArray(record.rawMessages) as PublishingDraftRecord["rawMessages"],
    lastSuggestedValues: toSuggestedValues(record.lastSuggestedValues),
    createdAt: toIsoDate(record.createdAt),
    updatedAt: toIsoDate(record.updatedAt),
  } satisfies PublishingDraftRecord;
}

type PublishingDraftRow = {
  id: string;
  ownerId: string;
  ownerDisplayName: string;
  mode: string;
  status: string;
  linkedEntityId: string | null;
  currentStep: string | null;
  missingFields: string[];
  payload: Prisma.JsonValue;
  rawMessages: Prisma.JsonValue;
  lastSuggestedValues: Prisma.JsonValue;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function getPublishingDraftDelegate() {
  const candidate = (prisma as unknown as { appPublishingDraft?: unknown }).appPublishingDraft;
  return candidate ?? null;
}

async function listPublishingDraftsRaw(ownerId: string, mode?: PublishingMode) {
  const rows = await prisma.$queryRaw<PublishingDraftRow[]>(Prisma.sql`
    SELECT
      id,
      "ownerId",
      "ownerDisplayName",
      mode,
      status,
      "linkedEntityId",
      "currentStep",
      "missingFields",
      payload,
      "rawMessages",
      "lastSuggestedValues",
      "createdAt",
      "updatedAt"
    FROM "AppPublishingDraft"
    WHERE "ownerId" = ${ownerId}
    ${mode ? Prisma.sql`AND mode = ${mode}` : Prisma.empty}
    ORDER BY "updatedAt" DESC
  `);

  return rows.map(toDraftRecord);
}

async function getPublishingDraftByIdRaw(id: string) {
  const rows = await prisma.$queryRaw<PublishingDraftRow[]>(Prisma.sql`
    SELECT
      id,
      "ownerId",
      "ownerDisplayName",
      mode,
      status,
      "linkedEntityId",
      "currentStep",
      "missingFields",
      payload,
      "rawMessages",
      "lastSuggestedValues",
      "createdAt",
      "updatedAt"
    FROM "AppPublishingDraft"
    WHERE id = ${id}
    LIMIT 1
  `);

  return rows[0] ? toDraftRecord(rows[0]) : null;
}

async function createPublishingDraftRaw(input: {
  ownerId: string;
  ownerDisplayName: string;
  mode: PublishingMode;
  linkedEntityId?: string | null;
}) {
  const payloadJson = toJsonString(defaultPublishingStructuredDraft);
  const rawMessagesJson = toJsonString([]);
  const lastSuggestedValuesJson = toJsonString({});

  const rows = await prisma.$queryRaw<PublishingDraftRow[]>(Prisma.sql`
    INSERT INTO "AppPublishingDraft" (
      id,
      "ownerId",
      "ownerDisplayName",
      mode,
      status,
      "linkedEntityId",
      "currentStep",
      "missingFields",
      payload,
      "rawMessages",
      "lastSuggestedValues",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${nextId("pub-draft")},
      ${input.ownerId},
      ${input.ownerDisplayName},
      ${input.mode},
      ${"IN_PROGRESS"},
      ${input.linkedEntityId ?? null},
      ${null},
      ${[] as string[]},
      CAST(${payloadJson} AS jsonb),
      CAST(${rawMessagesJson} AS jsonb),
      CAST(${lastSuggestedValuesJson} AS jsonb),
      NOW(),
      NOW()
    )
    RETURNING
      id,
      "ownerId",
      "ownerDisplayName",
      mode,
      status,
      "linkedEntityId",
      "currentStep",
      "missingFields",
      payload,
      "rawMessages",
      "lastSuggestedValues",
      "createdAt",
      "updatedAt"
  `);

  if (!rows[0]) {
    throw new Error("Unable to create publishing draft.");
  }

  return toDraftRecord(rows[0]);
}

async function updatePublishingDraftRaw(
  id: string,
  updates: Partial<Pick<PublishingDraftRecord, "status" | "linkedEntityId" | "currentStep" | "missingFields" | "payload" | "rawMessages" | "lastSuggestedValues">>,
) {
  const existing = await getPublishingDraftByIdRaw(id);
  if (!existing) {
    throw new Error("Publishing draft not found.");
  }

  const payloadJson = toJsonString(updates.payload ?? existing.payload);
  const rawMessagesJson = toJsonString(updates.rawMessages ?? existing.rawMessages);
  const lastSuggestedValuesJson = toJsonString(updates.lastSuggestedValues ?? existing.lastSuggestedValues);

  const rows = await prisma.$queryRaw<PublishingDraftRow[]>(Prisma.sql`
    UPDATE "AppPublishingDraft"
    SET
      status = ${updates.status ?? existing.status},
      "linkedEntityId" = ${typeof updates.linkedEntityId === "undefined" ? existing.linkedEntityId : updates.linkedEntityId},
      "currentStep" = ${typeof updates.currentStep === "undefined" ? existing.currentStep : updates.currentStep},
      "missingFields" = ${(updates.missingFields ?? existing.missingFields) as string[]},
      payload = CAST(${payloadJson} AS jsonb),
      "rawMessages" = CAST(${rawMessagesJson} AS jsonb),
      "lastSuggestedValues" = CAST(${lastSuggestedValuesJson} AS jsonb),
      "updatedAt" = NOW()
    WHERE id = ${id}
    RETURNING
      id,
      "ownerId",
      "ownerDisplayName",
      mode,
      status,
      "linkedEntityId",
      "currentStep",
      "missingFields",
      payload,
      "rawMessages",
      "lastSuggestedValues",
      "createdAt",
      "updatedAt"
  `);

  if (!rows[0]) {
    throw new Error("Unable to update publishing draft.");
  }

  return toDraftRecord(rows[0]);
}

async function findOpenPublishingDraftForOwnerRaw(input: { ownerId: string; mode: PublishingMode }) {
  const rows = await prisma.$queryRaw<PublishingDraftRow[]>(Prisma.sql`
    SELECT
      id,
      "ownerId",
      "ownerDisplayName",
      mode,
      status,
      "linkedEntityId",
      "currentStep",
      "missingFields",
      payload,
      "rawMessages",
      "lastSuggestedValues",
      "createdAt",
      "updatedAt"
    FROM "AppPublishingDraft"
    WHERE "ownerId" = ${input.ownerId}
      AND mode = ${input.mode}
      AND status IN (${Prisma.join(["IN_PROGRESS", "DRAFT"])})
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `);

  return rows[0] ? toDraftRecord(rows[0]) : null;
}

export async function listPublishingDrafts(ownerId: string, mode?: PublishingMode) {
  const delegate = getPublishingDraftDelegate();
  if (!delegate) {
    return listPublishingDraftsRaw(ownerId, mode);
  }

  const drafts = await (delegate as typeof prisma.appAuthUser).findMany({
    where: {
      ownerId,
      ...(mode ? { mode } : {}),
    },
    orderBy: { updatedAt: "desc" },
  } as never);

  return (drafts as unknown as PublishingDraftRow[]).map(toDraftRecord);
}

export async function getPublishingDraftById(id: string) {
  const delegate = getPublishingDraftDelegate();
  if (!delegate) {
    return getPublishingDraftByIdRaw(id);
  }

  const record = await (delegate as typeof prisma.appAuthUser).findUnique({
    where: { id },
  } as never);

  return record ? toDraftRecord(record as unknown as PublishingDraftRow) : null;
}

export async function createPublishingDraft(input: {
  ownerId: string;
  ownerDisplayName: string;
  mode: PublishingMode;
  linkedEntityId?: string | null;
}) {
  const delegate = getPublishingDraftDelegate();
  if (!delegate) {
    return createPublishingDraftRaw(input);
  }

  const created = await (delegate as typeof prisma.appAuthUser).create({
    data: {
      id: nextId("pub-draft"),
      ownerId: input.ownerId,
      ownerDisplayName: input.ownerDisplayName,
      mode: input.mode,
      status: "IN_PROGRESS",
      linkedEntityId: input.linkedEntityId ?? null,
      currentStep: null,
      missingFields: [],
      payload: defaultPublishingStructuredDraft as unknown as Prisma.InputJsonValue,
      rawMessages: [] as unknown as Prisma.InputJsonValue,
      lastSuggestedValues: {} as unknown as Prisma.InputJsonValue,
    },
  } as never);

  return toDraftRecord(created as unknown as PublishingDraftRow);
}

export async function updatePublishingDraft(
  id: string,
  updates: Partial<Pick<PublishingDraftRecord, "status" | "linkedEntityId" | "currentStep" | "missingFields" | "payload" | "rawMessages" | "lastSuggestedValues">>,
) {
  const delegate = getPublishingDraftDelegate();
  if (!delegate) {
    return updatePublishingDraftRaw(id, updates);
  }

  const updated = await (delegate as typeof prisma.appAuthUser).update({
    where: { id },
    data: {
      status: updates.status,
      linkedEntityId: typeof updates.linkedEntityId === "undefined" ? undefined : updates.linkedEntityId,
      currentStep: typeof updates.currentStep === "undefined" ? undefined : updates.currentStep,
      missingFields: updates.missingFields,
      payload: updates.payload as unknown as Prisma.InputJsonValue,
      rawMessages: updates.rawMessages as unknown as Prisma.InputJsonValue,
      lastSuggestedValues: updates.lastSuggestedValues as unknown as Prisma.InputJsonValue,
    },
  } as never);

  return toDraftRecord(updated as unknown as PublishingDraftRow);
}

export async function upsertPublishingDraftForOwner(input: {
  ownerId: string;
  ownerDisplayName: string;
  mode: PublishingMode;
}) {
  const delegate = getPublishingDraftDelegate();
  const existing = delegate
    ? await (delegate as typeof prisma.appAuthUser).findFirst({
        where: {
          ownerId: input.ownerId,
          mode: input.mode,
          status: {
            in: ["IN_PROGRESS", "DRAFT"],
          },
        },
        orderBy: { updatedAt: "desc" },
      } as never)
    : await findOpenPublishingDraftForOwnerRaw(input);

  if (existing) {
    return toDraftRecord(existing as unknown as PublishingDraftRow);
  }

  return createPublishingDraft(input);
}
