import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";

import { google } from "googleapis";

import { prisma } from "@/lib/prisma";
import type { PlatformYouTubeConnectionView, PublicYouTubeConnectionStatus } from "@/lib/gigxomi/platform-youtube-types";

const PLATFORM_YOUTUBE_CONNECTION_KEY = "gigxomi-shared-channel";
const PLATFORM_YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;
const PLATFORM_YOUTUBE_CONNECTION_STATUS = {
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  ERROR: "ERROR",
} as const;
const PLATFORM_YOUTUBE_PUBLISH_JOB_STATUS = {
  PENDING: "PENDING",
  UPLOADING: "UPLOADING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
} as const;
type PlatformYouTubeConnectionStatusValue =
  (typeof PLATFORM_YOUTUBE_CONNECTION_STATUS)[keyof typeof PLATFORM_YOUTUBE_CONNECTION_STATUS];

export type YouTubePublishJobView = {
  id: string;
  assetId: string;
  draftId: string;
  tenantId: string | null;
  conversationId: string;
  freelancerId: string | null;
  freelancerName: string | null;
  title: string;
  description: string;
  privacy: "private" | "unlisted" | "public";
  categoryId: string | null;
  tags: string[];
  madeForKids: boolean;
  status: "PENDING" | "UPLOADING" | "PUBLISHED" | "FAILED";
  sourceFileName: string;
  sourceFilePath: string;
  sourceMimeType: string;
  sourceSizeBytes: number | null;
  videoId: string | null;
  videoUrl: string | null;
  error: string | null;
  retryCount: number;
  queuedAt: string;
  lastAttemptAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublishPlatformYouTubeInput = {
  jobId?: string | null;
  assetId: string;
  draftId: string;
  tenantId?: string | null;
  conversationId: string;
  freelancerId?: string | null;
  freelancerName?: string | null;
  title: string;
  description: string;
  privacy: "private" | "unlisted" | "public";
  categoryId?: string | null;
  tags: string[];
  madeForKids: boolean;
  sourceFilePath: string;
  sourceFileName: string;
  sourceMimeType: string;
  sourceSizeBytes?: number | null;
  existingVideoId?: string | null;
};

type YouTubeEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
  missingEnv: string[];
  ready: boolean;
};

function getYouTubeEnv(): YouTubeEnv {
  const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_YOUTUBE_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.GOOGLE_YOUTUBE_REDIRECT_URI?.trim() ?? "";
  const encryptionKey = process.env.GOOGLE_YOUTUBE_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  const missingEnv = [
    !clientId ? "GOOGLE_YOUTUBE_CLIENT_ID" : null,
    !clientSecret ? "GOOGLE_YOUTUBE_CLIENT_SECRET" : null,
    !redirectUri ? "GOOGLE_YOUTUBE_REDIRECT_URI" : null,
    !encryptionKey ? "GOOGLE_YOUTUBE_TOKEN_ENCRYPTION_KEY" : null,
  ].filter(Boolean) as string[];

  return {
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey,
    missingEnv,
    ready: missingEnv.length === 0,
  };
}

function requireReadyEnv() {
  const env = getYouTubeEnv();
  if (!env.ready) {
    throw new Error(`YouTube publishing env is missing: ${env.missingEnv.join(", ")}`);
  }
  return env;
}

function encryptSecret(value: string, secret: string) {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(secret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSecret(value: string | null | undefined, secret: string) {
  if (!value) {
    return "";
  }

  const [ivPart, tagPart, payloadPart] = value.split(".");
  if (!ivPart || !tagPart || !payloadPart) {
    throw new Error("Stored YouTube token could not be decrypted.");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const payload = Buffer.from(payloadPart, "base64url");
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
}

function buildOAuthClient(env: YouTubeEnv) {
  const client = new google.auth.OAuth2(env.clientId, env.clientSecret, env.redirectUri);
  client.on("tokens", (tokens) => {
    if (!tokens.access_token && !tokens.refresh_token) {
      return;
    }

    void prisma.platformYouTubeConnection.upsert({
      where: { connectionKey: PLATFORM_YOUTUBE_CONNECTION_KEY },
      create: {
        connectionKey: PLATFORM_YOUTUBE_CONNECTION_KEY,
        status: PLATFORM_YOUTUBE_CONNECTION_STATUS.CONNECTED,
        accessTokenCipher: tokens.access_token ? encryptSecret(tokens.access_token, env.encryptionKey) : null,
        refreshTokenCipher: tokens.refresh_token ? encryptSecret(tokens.refresh_token, env.encryptionKey) : null,
        accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: typeof tokens.scope === "string" ? tokens.scope : null,
      },
      update: {
        accessTokenCipher: tokens.access_token ? encryptSecret(tokens.access_token, env.encryptionKey) : undefined,
        refreshTokenCipher: tokens.refresh_token ? encryptSecret(tokens.refresh_token, env.encryptionKey) : undefined,
        accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scope: typeof tokens.scope === "string" ? tokens.scope : undefined,
      },
    }).catch(() => undefined);
  });

  return client;
}

function normalizeChannelHandle(value?: string | null) {
  if (!value?.trim()) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function toConnectionView(
  input:
    | (Awaited<ReturnType<typeof prisma.platformYouTubeConnection.findUnique>> & {
        status?: PlatformYouTubeConnectionStatusValue;
      })
    | null,
) {
  const env = getYouTubeEnv();
  const status: PublicYouTubeConnectionStatus = !env.ready
    ? "ENV_MISSING"
    : !input
      ? "DISCONNECTED"
      : input.status === PLATFORM_YOUTUBE_CONNECTION_STATUS.CONNECTED
        ? "CONNECTED"
        : input.status === PLATFORM_YOUTUBE_CONNECTION_STATUS.ERROR
          ? "ERROR"
          : "DISCONNECTED";

  return {
    status,
    envReady: env.ready,
    missingEnv: env.missingEnv,
    channelName: input?.channelName ?? null,
    channelId: input?.channelId ?? null,
    channelHandle: input?.channelHandle ?? null,
    connectedAt: input?.connectedAt?.toISOString() ?? null,
    lastValidatedAt: input?.lastValidatedAt?.toISOString() ?? null,
    lastError: input?.lastError ?? null,
    scope: input?.scope ?? null,
    canConnect: env.ready,
    canPublish: env.ready && status === "CONNECTED" && Boolean(input?.refreshTokenCipher),
  } satisfies PlatformYouTubeConnectionView;
}

function toPublishJobView(job: Awaited<ReturnType<typeof prisma.platformYouTubePublishJob.findFirstOrThrow>>) {
  return {
    id: job.id,
    assetId: job.assetId,
    draftId: job.draftId,
    tenantId: job.tenantId,
    conversationId: job.conversationId,
    freelancerId: job.freelancerId,
    freelancerName: job.freelancerName,
    title: job.title,
    description: job.description ?? "",
    privacy: job.privacy as "private" | "unlisted" | "public",
    categoryId: job.categoryId,
    tags: job.tags,
    madeForKids: job.madeForKids,
    status: job.status,
    sourceFileName: job.sourceFileName,
    sourceFilePath: job.sourceFilePath,
    sourceMimeType: job.sourceMimeType,
    sourceSizeBytes: job.sourceSizeBytes ? Number(job.sourceSizeBytes) : null,
    videoId: job.youtubeVideoId,
    videoUrl: job.youtubeVideoUrl,
    error: job.lastError,
    retryCount: job.retryCount,
    queuedAt: job.queuedAt.toISOString(),
    lastAttemptAt: job.lastAttemptAt?.toISOString() ?? null,
    publishedAt: job.publishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  } satisfies YouTubePublishJobView;
}

async function getStoredConnection() {
  return prisma.platformYouTubeConnection.findUnique({
    where: { connectionKey: PLATFORM_YOUTUBE_CONNECTION_KEY },
  });
}

async function getAuthorizedClient() {
  const env = requireReadyEnv();
  const connection = await getStoredConnection();
  if (!connection?.refreshTokenCipher) {
    throw new Error("The shared Gigxomi YouTube channel is not connected yet.");
  }

  const client = buildOAuthClient(env);
  client.setCredentials({
    access_token: connection.accessTokenCipher ? decryptSecret(connection.accessTokenCipher, env.encryptionKey) : undefined,
    refresh_token: decryptSecret(connection.refreshTokenCipher, env.encryptionKey),
    expiry_date: connection.accessTokenExpiresAt?.getTime(),
  });

  return {
    client,
    connection,
    env,
  };
}

export function getPlatformYouTubeConnectUrl(state: string) {
  const env = requireReadyEnv();
  const client = buildOAuthClient(env);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...PLATFORM_YOUTUBE_SCOPES],
    include_granted_scopes: true,
    state,
  });
}

export async function getPlatformYouTubeConnectionView() {
  return toConnectionView(await getStoredConnection());
}

export async function exchangeYouTubeCodeForSharedConnection(code: string) {
  const env = requireReadyEnv();
  const existing = await getStoredConnection();
  const client = buildOAuthClient(env);
  const tokenResponse = await client.getToken(code);
  client.setCredentials(tokenResponse.tokens);

  const refreshToken =
    tokenResponse.tokens.refresh_token ||
    (existing?.refreshTokenCipher ? decryptSecret(existing.refreshTokenCipher, env.encryptionKey) : "");

  if (!refreshToken) {
    throw new Error("Google did not return a refresh token. Reconnect with consent again.");
  }

  const youtube = google.youtube({
    version: "v3",
    auth: client,
  });
  const channelResponse = await youtube.channels.list({
    mine: true,
    part: ["snippet"],
    maxResults: 1,
  });
  const channel = channelResponse.data.items?.[0];
  const channelId = channel?.id?.trim();
  const channelName = channel?.snippet?.title?.trim();
  const channelHandle = normalizeChannelHandle(channel?.snippet?.customUrl ?? null);

  if (!channelId || !channelName) {
    throw new Error("No YouTube channel was resolved for the connected Google account.");
  }

  await prisma.platformYouTubeConnection.upsert({
    where: { connectionKey: PLATFORM_YOUTUBE_CONNECTION_KEY },
    create: {
      connectionKey: PLATFORM_YOUTUBE_CONNECTION_KEY,
      status: PLATFORM_YOUTUBE_CONNECTION_STATUS.CONNECTED,
      channelId,
      channelName,
      channelHandle,
      refreshTokenCipher: encryptSecret(refreshToken, env.encryptionKey),
      accessTokenCipher: tokenResponse.tokens.access_token ? encryptSecret(tokenResponse.tokens.access_token, env.encryptionKey) : null,
      accessTokenExpiresAt: tokenResponse.tokens.expiry_date ? new Date(tokenResponse.tokens.expiry_date) : null,
      scope: typeof tokenResponse.tokens.scope === "string" ? tokenResponse.tokens.scope : PLATFORM_YOUTUBE_SCOPES.join(" "),
      connectedAt: new Date(),
      lastValidatedAt: new Date(),
      lastError: null,
    },
    update: {
      status: PLATFORM_YOUTUBE_CONNECTION_STATUS.CONNECTED,
      channelId,
      channelName,
      channelHandle,
      refreshTokenCipher: encryptSecret(refreshToken, env.encryptionKey),
      accessTokenCipher: tokenResponse.tokens.access_token ? encryptSecret(tokenResponse.tokens.access_token, env.encryptionKey) : null,
      accessTokenExpiresAt: tokenResponse.tokens.expiry_date ? new Date(tokenResponse.tokens.expiry_date) : null,
      scope: typeof tokenResponse.tokens.scope === "string" ? tokenResponse.tokens.scope : PLATFORM_YOUTUBE_SCOPES.join(" "),
      connectedAt: existing?.connectedAt ?? new Date(),
      lastValidatedAt: new Date(),
      lastError: null,
    },
  });

  return getPlatformYouTubeConnectionView();
}

export async function disconnectPlatformYouTubeConnection() {
  await prisma.platformYouTubeConnection.upsert({
    where: { connectionKey: PLATFORM_YOUTUBE_CONNECTION_KEY },
    create: {
      connectionKey: PLATFORM_YOUTUBE_CONNECTION_KEY,
      status: PLATFORM_YOUTUBE_CONNECTION_STATUS.DISCONNECTED,
    },
    update: {
      status: PLATFORM_YOUTUBE_CONNECTION_STATUS.DISCONNECTED,
      channelId: null,
      channelName: null,
      channelHandle: null,
      refreshTokenCipher: null,
      accessTokenCipher: null,
      accessTokenExpiresAt: null,
      scope: null,
      connectedAt: null,
      lastValidatedAt: null,
      lastError: null,
    },
  });

  return getPlatformYouTubeConnectionView();
}

export async function listPlatformYouTubePublishJobs(options?: { assetIds?: string[]; limit?: number }) {
  const jobs = await prisma.platformYouTubePublishJob.findMany({
    where:
      options?.assetIds?.length
        ? {
            assetId: {
              in: options.assetIds,
            },
          }
        : undefined,
    orderBy: [{ createdAt: "desc" }],
    take: options?.limit ?? undefined,
  });

  return jobs.map((job: Awaited<ReturnType<typeof prisma.platformYouTubePublishJob.findFirstOrThrow>>) => toPublishJobView(job));
}

export async function getPlatformYouTubePublishJob(jobId: string) {
  const job = await prisma.platformYouTubePublishJob.findUnique({
    where: { id: jobId },
  });
  return job ? toPublishJobView(job) : null;
}

async function upsertPublishJobRecord(input: PublishPlatformYouTubeInput) {
  if (input.jobId) {
    return prisma.platformYouTubePublishJob.update({
      where: { id: input.jobId },
      data: {
        title: input.title,
        description: input.description,
        privacy: input.privacy,
        categoryId: input.categoryId ?? null,
        tags: input.tags,
        madeForKids: input.madeForKids,
        sourceFilePath: input.sourceFilePath,
        sourceFileName: input.sourceFileName,
        sourceMimeType: input.sourceMimeType,
        sourceSizeBytes: typeof input.sourceSizeBytes === "number" ? BigInt(input.sourceSizeBytes) : null,
        status: PLATFORM_YOUTUBE_PUBLISH_JOB_STATUS.PENDING,
        lastError: null,
      },
    });
  }

  return prisma.platformYouTubePublishJob.create({
    data: {
      assetId: input.assetId,
      draftId: input.draftId,
      tenantId: input.tenantId ?? null,
      conversationId: input.conversationId,
      freelancerId: input.freelancerId ?? null,
      freelancerName: input.freelancerName ?? null,
      title: input.title,
      description: input.description,
      privacy: input.privacy,
      categoryId: input.categoryId ?? null,
      tags: input.tags,
      madeForKids: input.madeForKids,
      sourceFilePath: input.sourceFilePath,
      sourceFileName: input.sourceFileName,
      sourceMimeType: input.sourceMimeType,
      sourceSizeBytes: typeof input.sourceSizeBytes === "number" ? BigInt(input.sourceSizeBytes) : null,
      status: PLATFORM_YOUTUBE_PUBLISH_JOB_STATUS.PENDING,
    },
  });
}

export async function publishPlatformVideo(input: PublishPlatformYouTubeInput) {
  const { client, connection } = await getAuthorizedClient();
  const youtube = google.youtube({
    version: "v3",
    auth: client,
  });

  const job = await upsertPublishJobRecord(input);

  await prisma.platformYouTubePublishJob.update({
    where: { id: job.id },
    data: {
      status: PLATFORM_YOUTUBE_PUBLISH_JOB_STATUS.UPLOADING,
      lastAttemptAt: new Date(),
      lastError: null,
    },
  });

  try {
    let videoId = input.existingVideoId ?? null;

    if (videoId) {
      const updateResponse = await youtube.videos.update({
        part: ["snippet", "status"],
        requestBody: {
          id: videoId,
          snippet: {
            title: input.title,
            description: input.description,
            tags: input.tags,
            categoryId: input.categoryId ?? undefined,
          },
          status: {
            privacyStatus: input.privacy,
            selfDeclaredMadeForKids: input.madeForKids,
          },
        },
      });
      videoId = updateResponse.data.id ?? videoId;
    } else {
      const uploadResponse = await youtube.videos.insert({
        part: ["snippet", "status"],
        notifySubscribers: false,
        requestBody: {
          snippet: {
            title: input.title,
            description: input.description,
            tags: input.tags,
            categoryId: input.categoryId ?? undefined,
          },
          status: {
            privacyStatus: input.privacy,
            selfDeclaredMadeForKids: input.madeForKids,
          },
        },
        media: {
          mimeType: input.sourceMimeType,
          body: createReadStream(input.sourceFilePath),
        },
      });
      videoId = uploadResponse.data.id ?? null;
    }

    if (!videoId) {
      throw new Error("YouTube did not return a video ID for this publish request.");
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const published = await prisma.platformYouTubePublishJob.update({
      where: { id: job.id },
      data: {
        status: PLATFORM_YOUTUBE_PUBLISH_JOB_STATUS.PUBLISHED,
        youtubeVideoId: videoId,
        youtubeVideoUrl: videoUrl,
        lastError: null,
        publishedAt: new Date(),
      },
    });

    await prisma.platformYouTubeConnection.updateMany({
      where: { connectionKey: PLATFORM_YOUTUBE_CONNECTION_KEY },
      data: {
        status: PLATFORM_YOUTUBE_CONNECTION_STATUS.CONNECTED,
        lastValidatedAt: new Date(),
        lastError: null,
      },
    });

    return toPublishJobView(published);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to publish this video to YouTube.";
    const failed = await prisma.platformYouTubePublishJob.update({
      where: { id: job.id },
      data: {
        status: PLATFORM_YOUTUBE_PUBLISH_JOB_STATUS.FAILED,
        lastError: message,
        retryCount: { increment: 1 },
      },
    });

    await prisma.platformYouTubeConnection.updateMany({
      where: { connectionKey: PLATFORM_YOUTUBE_CONNECTION_KEY },
      data: {
        status: PLATFORM_YOUTUBE_CONNECTION_STATUS.ERROR,
        lastError: message,
      },
    });

    throw Object.assign(new Error(message), {
      publishJob: toPublishJobView(failed),
      connectionStatus: toConnectionView(connection),
    });
  }
}
