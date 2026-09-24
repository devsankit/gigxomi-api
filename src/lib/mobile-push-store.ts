import "server-only";

import { Prisma } from "@prisma/client";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, type Message } from "firebase-admin/messaging";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "mobile-push-tokens.json");
const FIREBASE_APP_NAME = "gigxomi-mobile-push";

export type MobilePushPlatform = "android" | "ios" | "web";
export type MobilePushProvider = "fcm";

export type MobilePushTokenRecord = {
  id: string;
  provider: MobilePushProvider;
  role?: string;
  userId: string;
  tenantId: string | null;
  platform: MobilePushPlatform;
  projectOfferChannelId: string | null;
  supportsProjectOfferActions: boolean;
  token: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
};

type MobilePushTokenSnapshot = {
  tokens: MobilePushTokenRecord[];
};

type MobilePushMessage = {
  androidDataOnly?: boolean;
  androidDataOnlyForRecord?: (record: MobilePushTokenRecord) => boolean;
  body: string;
  data?: Record<string, string>;
  dataForRecord?: (record: MobilePushTokenRecord) => Record<string, string>;
  title: string;
};

type MobilePushTokenRow = {
  createdAt: Date | string;
  disabledAt: Date | string | null;
  id: string;
  platform: string;
  provider: string | null;
  projectOfferChannelId: string | null;
  role: string | null;
  supportsProjectOfferActions: boolean | null;
  tenantId: string | null;
  token: string;
  tokenHash: string;
  updatedAt: Date | string;
  userId: string;
};

let databaseStoreReadyPromise: Promise<boolean> | null = null;
let lastDatabaseStoreError = "";
let lastDatabaseStoreCheckAt = 0;
let lastDatabaseStoreReady = false;
const DATABASE_STORE_RECHECK_MS = 15_000;

function allowRuntimePushSchemaBootstrap() {
  if (process.env.GIGXOMI_RUNTIME_SCHEMA_BOOTSTRAP === "0") {
    return false;
  }
  return process.env.NODE_ENV !== "production" || process.env.GIGXOMI_RUNTIME_SCHEMA_BOOTSTRAP === "1";
}

function allowPushFileFallback() {
  if (process.env.GIGXOMI_FILE_PUSH_FALLBACK === "0") {
    return false;
  }
  return true;
}

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isExpoPushToken(token: string) {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

function normalizePushProvider(value: unknown): MobilePushProvider {
  if (value === "fcm") return "fcm";
  return "fcm";
}

async function readSnapshot(): Promise<MobilePushTokenSnapshot> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<MobilePushTokenSnapshot>;
    return { tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [] };
  } catch {
    return { tokens: [] };
  }
}

async function writeSnapshot(snapshot: MobilePushTokenSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
}

function toIso(value: Date | string | null) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToRecord(row: MobilePushTokenRow): MobilePushTokenRecord {
  return {
    id: row.id,
    provider: normalizePushProvider(row.provider),
    role: row.role ?? undefined,
    userId: row.userId,
    tenantId: row.tenantId,
    platform: row.platform === "ios" || row.platform === "web" ? row.platform : "android",
    projectOfferChannelId: row.projectOfferChannelId?.trim() || null,
    supportsProjectOfferActions: row.supportsProjectOfferActions === true,
    token: row.token,
    tokenHash: row.tokenHash,
    createdAt: toIso(row.createdAt) ?? nowIso(),
    updatedAt: toIso(row.updatedAt) ?? nowIso(),
    disabledAt: toIso(row.disabledAt),
  };
}

async function migrateFileTokensToDatabase() {
  const snapshot = await readSnapshot();
  if (!snapshot.tokens.length) {
    return;
  }

  await Promise.all(
    snapshot.tokens.map((record) =>
      prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "MobilePushToken"
            ("id", "provider", "role", "userId", "tenantId", "platform", "projectOfferChannelId", "supportsProjectOfferActions", "token", "tokenHash", "createdAt", "updatedAt", "disabledAt")
          VALUES
            (${record.id}, ${record.provider ?? normalizePushProvider(undefined)}, ${record.role ?? null}, ${record.userId}, ${record.tenantId}, ${record.platform}, ${record.projectOfferChannelId ?? null}, ${record.supportsProjectOfferActions === true}, ${record.token}, ${record.tokenHash}, ${new Date(record.createdAt)}, ${new Date(record.updatedAt)}, ${record.disabledAt ? new Date(record.disabledAt) : null})
          ON CONFLICT ("tokenHash") DO NOTHING
        `,
      ),
    ),
  );
}

async function ensureDatabaseStoreReady() {
  const now = Date.now();
  if (
    databaseStoreReadyPromise &&
    now - lastDatabaseStoreCheckAt < DATABASE_STORE_RECHECK_MS
  ) {
    return databaseStoreReadyPromise;
  }
  if (!databaseStoreReadyPromise || !lastDatabaseStoreReady) {
    databaseStoreReadyPromise = (async () => {
      lastDatabaseStoreCheckAt = Date.now();
      try {
        if (allowRuntimePushSchemaBootstrap()) {
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "MobilePushToken" (
              "id" TEXT PRIMARY KEY,
              "provider" TEXT NOT NULL DEFAULT 'fcm',
              "role" TEXT,
              "userId" TEXT NOT NULL,
              "tenantId" TEXT,
              "platform" TEXT NOT NULL DEFAULT 'android',
              "projectOfferChannelId" TEXT,
              "supportsProjectOfferActions" BOOLEAN NOT NULL DEFAULT FALSE,
              "token" TEXT NOT NULL,
              "tokenHash" TEXT NOT NULL UNIQUE,
              "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              "disabledAt" TIMESTAMPTZ
            );
          `);
          await prisma.$executeRawUnsafe(`ALTER TABLE "MobilePushToken" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'fcm';`);
          await prisma.$executeRawUnsafe(`ALTER TABLE "MobilePushToken" ADD COLUMN IF NOT EXISTS "projectOfferChannelId" TEXT;`);
          await prisma.$executeRawUnsafe(`ALTER TABLE "MobilePushToken" ADD COLUMN IF NOT EXISTS "supportsProjectOfferActions" BOOLEAN NOT NULL DEFAULT FALSE;`);
          await prisma.$executeRawUnsafe(`
            UPDATE "MobilePushToken"
            SET "disabledAt" = NOW(), "updatedAt" = NOW()
            WHERE ("token" LIKE 'ExpoPushToken[%' OR "token" LIKE 'ExponentPushToken[%') AND "disabledAt" IS NULL;
          `);
          await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MobilePushToken_userId_idx" ON "MobilePushToken"("userId");`);
          await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MobilePushToken_tenantId_idx" ON "MobilePushToken"("tenantId");`);
          await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MobilePushToken_disabledAt_idx" ON "MobilePushToken"("disabledAt");`);
          await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MobilePushToken_provider_idx" ON "MobilePushToken"("provider");`);
        } else {
          const tableRows = await prisma.$queryRaw<Array<{ exists: string | null }>>`
            SELECT to_regclass('"MobilePushToken"')::text AS "exists"
          `;
          if (!tableRows[0]?.exists) {
            return false;
          }
        }

        const countRows = await prisma.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`SELECT COUNT(*)::int AS count FROM "MobilePushToken"`);
        const count = Number(countRows[0]?.count ?? 0);
        if (count === 0) {
          await migrateFileTokensToDatabase();
        }
        lastDatabaseStoreError = "";
        lastDatabaseStoreReady = true;
        return true;
      } catch (error) {
        lastDatabaseStoreError = error instanceof Error ? error.message : "Database store initialization failed.";
        lastDatabaseStoreReady = false;
        return false;
      }
    })();
  }

  return databaseStoreReadyPromise;
}

export async function getMobilePushStoreDiagnostics() {
  const databaseReady = await ensureDatabaseStoreReady();
  return {
    databaseReady,
    fallbackEnabled: allowPushFileFallback(),
    lastDatabaseStoreCheckAt: lastDatabaseStoreCheckAt ? new Date(lastDatabaseStoreCheckAt).toISOString() : null,
    lastDatabaseStoreError: lastDatabaseStoreError || null,
    mode: databaseReady ? "database" : allowPushFileFallback() ? "file-fallback" : "unavailable",
  };
}

async function upsertMobilePushTokenInDatabase(input: {
  platform: MobilePushPlatform;
  provider: MobilePushProvider;
  projectOfferChannelId: string | null;
  role?: string;
  supportsProjectOfferActions: boolean;
  tenantId: string | null;
  token: string;
  userId: string;
}) {
  const tokenHash = hashToken(input.token);
  const timestamp = new Date();
  const tokenId = `mpush-${tokenHash.slice(0, 16)}`;
  const rows = await prisma.$queryRaw<MobilePushTokenRow[]>(
    Prisma.sql`
      INSERT INTO "MobilePushToken"
        ("id", "provider", "role", "userId", "tenantId", "platform", "projectOfferChannelId", "supportsProjectOfferActions", "token", "tokenHash", "createdAt", "updatedAt", "disabledAt")
      VALUES
        (${tokenId}, ${input.provider}, ${input.role ?? null}, ${input.userId}, ${input.tenantId}, ${input.platform}, ${input.projectOfferChannelId}, ${input.supportsProjectOfferActions}, ${input.token}, ${tokenHash}, ${timestamp}, ${timestamp}, NULL)
      ON CONFLICT ("tokenHash") DO UPDATE SET
        "disabledAt" = NULL,
        "platform" = EXCLUDED."platform",
        "provider" = EXCLUDED."provider",
        "projectOfferChannelId" = EXCLUDED."projectOfferChannelId",
        "role" = EXCLUDED."role",
        "supportsProjectOfferActions" = EXCLUDED."supportsProjectOfferActions",
        "tenantId" = EXCLUDED."tenantId",
        "token" = EXCLUDED."token",
        "updatedAt" = EXCLUDED."updatedAt",
        "userId" = EXCLUDED."userId"
      RETURNING "id", "provider", "role", "userId", "tenantId", "platform", "projectOfferChannelId", "supportsProjectOfferActions", "token", "tokenHash", "createdAt", "updatedAt", "disabledAt"
    `,
  );

  return rowToRecord(rows[0]);
}

async function disableMobilePushTokenInDatabase(input: { token: string; userId: string }) {
  const tokenHash = hashToken(input.token);
  const timestamp = new Date();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      UPDATE "MobilePushToken"
      SET "disabledAt" = ${timestamp}, "updatedAt" = ${timestamp}
      WHERE "tokenHash" = ${tokenHash} AND "userId" = ${input.userId} AND "disabledAt" IS NULL
      RETURNING "id"
    `,
  );

  return { disabled: rows.length > 0 };
}

async function listMobilePushTokensFromDatabase(options?: { activeOnly?: boolean; userId?: string }) {
  const where = [
    ...(options?.userId ? [Prisma.sql`"userId" = ${options.userId}`] : []),
    ...(options?.activeOnly ? [Prisma.sql`"disabledAt" IS NULL`] : []),
  ];
  const rows = await prisma.$queryRaw<MobilePushTokenRow[]>(
    Prisma.sql`
      SELECT "id", "provider", "role", "userId", "tenantId", "platform", "projectOfferChannelId", "supportsProjectOfferActions", "token", "tokenHash", "createdAt", "updatedAt", "disabledAt"
      FROM "MobilePushToken"
      ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
      ORDER BY "updatedAt" DESC
    `,
  );

  return rows.map(rowToRecord);
}

async function disableMobilePushTokenHashesInDatabase(tokenHashes: Set<string>) {
  if (!tokenHashes.size) {
    return [] as string[];
  }

  const timestamp = new Date();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      UPDATE "MobilePushToken"
      SET "disabledAt" = ${timestamp}, "updatedAt" = ${timestamp}
      WHERE "tokenHash" IN (${Prisma.join([...tokenHashes])}) AND "disabledAt" IS NULL
      RETURNING "id"
    `,
  );

  return rows.map((row) => row.id);
}

export function assertValidFcmPushToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false as const, error: "Push token is required." };
  }
  if (isExpoPushToken(trimmed)) {
    return { ok: false as const, error: "Unsupported push token format. Expected a Firebase FCM device token from the mobile APK." };
  }
  if (trimmed.length < 20 || trimmed.length > 4096 || !/^[A-Za-z0-9_:\-.]+$/.test(trimmed)) {
    return { ok: false as const, error: "Unsupported push token format. Expected a Firebase FCM device token from the mobile APK." };
  }
  return { ok: true as const, token: trimmed };
}

export async function upsertMobilePushToken(input: {
  platform: MobilePushPlatform;
  provider: MobilePushProvider;
  projectOfferChannelId?: string | null;
  role?: string;
  supportsProjectOfferActions?: boolean;
  tenantId: string | null;
  token: string;
  userId: string;
}) {
  if (await ensureDatabaseStoreReady()) {
    return upsertMobilePushTokenInDatabase({
      ...input,
      projectOfferChannelId: input.projectOfferChannelId?.trim() || null,
      supportsProjectOfferActions: input.supportsProjectOfferActions === true,
    });
  }
  if (!allowPushFileFallback()) {
    throw new Error("Mobile push token storage is not migrated. Run database migrations before enabling push registration.");
  }

  const snapshot = await readSnapshot();
  const tokenHash = hashToken(input.token);
  const timestamp = nowIso();
  const existingIndex = snapshot.tokens.findIndex((record) => record.tokenHash === tokenHash);
  const nextRecord: MobilePushTokenRecord =
    existingIndex >= 0
      ? {
          ...snapshot.tokens[existingIndex],
          disabledAt: null,
          platform: input.platform,
          provider: input.provider,
          projectOfferChannelId: input.projectOfferChannelId?.trim() || null,
          role: input.role,
          supportsProjectOfferActions: input.supportsProjectOfferActions === true,
          tenantId: input.tenantId,
          token: input.token,
          updatedAt: timestamp,
          userId: input.userId,
        }
      : {
          id: `mpush-${tokenHash.slice(0, 16)}`,
          createdAt: timestamp,
          disabledAt: null,
          platform: input.platform,
          projectOfferChannelId: input.projectOfferChannelId?.trim() || null,
          supportsProjectOfferActions: input.supportsProjectOfferActions === true,
          provider: input.provider,
          role: input.role,
          tenantId: input.tenantId,
          token: input.token,
          tokenHash,
          updatedAt: timestamp,
          userId: input.userId,
        };

  if (existingIndex >= 0) {
    snapshot.tokens[existingIndex] = nextRecord;
  } else {
    snapshot.tokens.push(nextRecord);
  }

  await writeSnapshot(snapshot);
  return nextRecord;
}

export async function disableMobilePushToken(input: { token: string; userId: string }) {
  if (await ensureDatabaseStoreReady()) {
    return disableMobilePushTokenInDatabase(input);
  }
  if (!allowPushFileFallback()) {
    throw new Error("Mobile push token storage is not migrated. Run database migrations before disabling push tokens.");
  }

  const snapshot = await readSnapshot();
  const tokenHash = hashToken(input.token);
  let disabled = false;
  const timestamp = nowIso();

  snapshot.tokens = snapshot.tokens.map((record) => {
    if (record.tokenHash !== tokenHash || record.userId !== input.userId || record.disabledAt) {
      return record;
    }

    disabled = true;
    return {
      ...record,
      disabledAt: timestamp,
      updatedAt: timestamp,
    };
  });

  await writeSnapshot(snapshot);
  return { disabled };
}

export async function listMobilePushTokens(options?: { activeOnly?: boolean; userId?: string }) {
  if (await ensureDatabaseStoreReady()) {
    return listMobilePushTokensFromDatabase(options);
  }
  if (!allowPushFileFallback()) {
    return [];
  }

  const snapshot = await readSnapshot();
  return snapshot.tokens.filter((record) => {
    if (options?.userId && record.userId !== options.userId) {
      return false;
    }
    if (options?.activeOnly && record.disabledAt) {
      return false;
    }
    return true;
  });
}

export function maskPushToken(token: string) {
  if (token.length <= 18) {
    return token;
  }
  return `${token.slice(0, 16)}...${token.slice(-8)}`;
}

async function disableMobilePushTokenHashes(tokenHashes: Set<string>) {
  if (!tokenHashes.size) {
    return [] as string[];
  }

  if (await ensureDatabaseStoreReady()) {
    return disableMobilePushTokenHashesInDatabase(tokenHashes);
  }
  if (!allowPushFileFallback()) {
    return [];
  }

  const snapshot = await readSnapshot();
  const timestamp = nowIso();
  const disabledTokenIds: string[] = [];

  snapshot.tokens = snapshot.tokens.map((record) => {
    if (!tokenHashes.has(record.tokenHash) || record.disabledAt) {
      return record;
    }

    disabledTokenIds.push(record.id);
    return {
      ...record,
      disabledAt: timestamp,
      updatedAt: timestamp,
    };
  });

  if (disabledTokenIds.length) {
    await writeSnapshot(snapshot);
  }

  return disabledTokenIds;
}

function normalizeFirebasePrivateKey(value?: string) {
  return value?.replace(/\\n/g, "\n").trim() || "";
}

function getFirebaseProjectId() {
  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    ""
  );
}

function getFirebaseMessagingService() {
  const projectId = getFirebaseProjectId();
  if (!projectId) {
    return null;
  }

  const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
  if (existing) {
    return getMessaging(existing);
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = normalizeFirebasePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson) as {
      client_email?: string;
      private_key?: string;
      project_id?: string;
    };
    return getMessaging(
      initializeApp(
        {
          credential: cert({
            clientEmail: serviceAccount.client_email,
            privateKey: normalizeFirebasePrivateKey(serviceAccount.private_key),
            projectId: serviceAccount.project_id || projectId,
          }),
          projectId,
        },
        FIREBASE_APP_NAME,
      ),
    );
  }

  if (clientEmail && privateKey) {
    return getMessaging(
      initializeApp(
        {
          credential: cert({ clientEmail, privateKey, projectId }),
          projectId,
        },
        FIREBASE_APP_NAME,
      ),
    );
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
    const credentialPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
    if (credentialPath && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
    }
    return getMessaging(
      initializeApp(
        {
          credential: applicationDefault(),
          projectId,
        },
        FIREBASE_APP_NAME,
      ),
    );
  }

  return null;
}

function getFirebaseErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "");
  }
  return "";
}

function shouldDisableFcmToken(error: unknown) {
  const code = getFirebaseErrorCode(error);
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token" ||
    code === "messaging/invalid-argument"
  );
}

function stringData(data: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value ?? "")]));
}

export function isFirebasePushConfigured() {
  return Boolean(
    getFirebaseProjectId() &&
      (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) ||
        process.env.FIREBASE_SERVICE_ACCOUNT_FILE ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS),
  );
}

export async function sendMobilePushNotifications(records: MobilePushTokenRecord[], message: MobilePushMessage) {
  let activeRecords = records.filter((record) => !record.disabledAt && record.provider === "fcm");
  const viewingTargets = activeRecords.flatMap((record) => {
    const data = { ...(message.data ?? {}), ...(message.dataForRecord?.(record) ?? {}) };
    const type = data.type || "";
    const viewType = type.includes("chat") ? "chat" : type.includes("team") ? "team" : type.includes("project") || type.includes("assignment") || type.includes("work") ? "project" : "";
    const referenceId = viewType === "chat" ? data.conversationId : viewType === "team" ? data.teamRequestId || data.referenceId : data.assignmentId || data.projectId || data.referenceId;
    return viewType && referenceId ? [{ userId: record.userId, viewType, referenceId }] : [];
  });
  if (viewingTargets.length) {
    const activeViews = await prisma.mobileActiveView.findMany({ where: { expiresAt: { gt: new Date() }, OR: viewingTargets }, select: { userId: true, viewType: true, referenceId: true } });
    const suppressed = new Set(activeViews.map((item) => `${item.userId}:${item.viewType}:${item.referenceId}`));
    activeRecords = activeRecords.filter((record) => {
      const data = { ...(message.data ?? {}), ...(message.dataForRecord?.(record) ?? {}) };
      const type = data.type || "";
      const viewType = type.includes("chat") ? "chat" : type.includes("team") ? "team" : type.includes("project") || type.includes("assignment") || type.includes("work") ? "project" : "";
      const referenceId = viewType === "chat" ? data.conversationId : viewType === "team" ? data.teamRequestId || data.referenceId : data.assignmentId || data.projectId || data.referenceId;
      return !viewType || !referenceId || !suppressed.has(`${record.userId}:${viewType}:${referenceId}`);
    });
  }
  if (!activeRecords.length) {
    return {
      attempted: 0,
      disabledTokenIds: [] as string[],
      errors: [] as unknown[],
      failed: 0,
      invalidTokenCount: records.filter((record) => !record.disabledAt && record.provider !== "fcm").length,
      responses: [] as unknown[],
      sent: 0,
    };
  }

  const messaging = getFirebaseMessagingService();
  if (!messaging) {
    return {
      attempted: activeRecords.length,
      disabledTokenIds: [] as string[],
      errors: [{ error: "Firebase Admin credentials are not configured." }],
      failed: activeRecords.length,
      invalidTokenCount: records.filter((record) => !record.disabledAt && record.provider !== "fcm").length,
      responses: [] as unknown[],
      sent: 0,
    };
  }

  const errors: unknown[] = [];
  const responses: unknown[] = [];
  const tokenHashesToDisable = new Set<string>();

  await Promise.all(
    activeRecords.map(async (record) => {
      const messageData = message.data ?? {};
      const recordData = {
        ...messageData,
        ...(message.dataForRecord?.(record) ?? {}),
      };
      const useAndroidDataOnly =
        record.platform === "android" &&
        (message.androidDataOnlyForRecord?.(record) ?? message.androidDataOnly === true);
      const payload: Message = {
        token: record.token,
        data: {
          ...recordData,
          title: message.title,
          body: message.body,
          userId: record.userId,
        },
      };

      if (!useAndroidDataOnly) {
        payload.notification = {
          title: message.title,
          body: message.body,
        };
      }
      if (record.platform === "web") {
        const deepLinkUrl =
          recordData.deepLinkUrl ||
          (recordData.conversationId ? `/chat/${recordData.conversationId}` : "/notifications");
        payload.webpush = {
          headers: {
            Urgency: "high",
          },
          notification: {
            title: message.title,
            body: message.body,
            icon: "/gigxomi-logo.png",
            badge: "/gigxomi-logo.png",
            tag: recordData.conversationId ? `gigxomi-chat-${recordData.conversationId}` : "gigxomi-notification",
            renotify: true,
            requireInteraction: true,
          },
          fcmOptions: {
            link: deepLinkUrl,
          },
        };
      } else if (record.platform === "android") {
        const channelId = String(recordData.notificationChannelId ?? "").trim() || "gigxomi-default";
        payload.android = useAndroidDataOnly
          ? { priority: "high", ttl: 10 * 60 * 1000 }
          : {
              priority: "high",
              ttl: 10 * 60 * 1000,
              notification: {
                channelId,
                defaultVibrateTimings: true,
                priority: "max",
                tag: recordData.conversationId ? `project-offer-${recordData.conversationId}` : undefined,
                visibility: "private",
                sound:
                  /^gigxomi-project-offers-v(?:5|6)$/.test(recordData.notificationChannelId ?? "")
                    ? "project_offer_alarm"
                    : "default",
              },
            };
      } else {
        const categoryId = String(recordData.notificationCategoryId ?? "").trim();
        payload.apns = {
          payload: {
            aps: {
              category: categoryId || undefined,
              sound: "default",
            },
          },
        };
      }

      payload.data = stringData(payload.data ?? {});

      try {
        const response = await messaging.send(payload);
        responses.push({ id: response, tokenId: record.id });
      } catch (error) {
        errors.push({
          code: getFirebaseErrorCode(error),
          message: error instanceof Error ? error.message : "Firebase push send failed.",
          tokenId: record.id,
        });
        if (shouldDisableFcmToken(error)) {
          tokenHashesToDisable.add(record.tokenHash);
        }
      }
    }),
  );

  const disabledTokenIds = await disableMobilePushTokenHashes(tokenHashesToDisable);

  return {
    attempted: activeRecords.length,
    disabledTokenIds,
    errors,
    failed: errors.length,
    invalidTokenCount: records.filter((record) => !record.disabledAt && record.provider !== "fcm").length,
    responses,
    sent: responses.length,
  };
}
