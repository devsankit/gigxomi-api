function parseDbConfig(rawUrl) {
  const parsed = new URL(rawUrl);
  const isSupabasePooler = parsed.hostname.includes("pooler.supabase.com");

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ssl: isSupabasePooler
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  };
}

async function main() {
  await import("dotenv/config");
  const { Client } = await import("pg");
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = new Client(parseDbConfig(rawUrl));
  await client.connect();

  try {
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "PlatformYouTubeConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "PlatformYouTubePublishJobStatus" AS ENUM ('PENDING', 'UPLOADING', 'PUBLISHED', 'FAILED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "AppRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FREELANCER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "AppPackageAudience" AS ENUM ('FREELANCER', 'AGENCY');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "AppPackageStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "AppWorkspaceMode" AS ENUM ('AGENCY', 'FREELANCER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "AppAuthUser" (
        "id" TEXT PRIMARY KEY,
        "role" "AppRole" NOT NULL,
        "assignedRole" "AppRole" NOT NULL,
        "tenantId" TEXT,
        "displayName" TEXT NOT NULL,
        "email" TEXT UNIQUE,
        "phone" TEXT NOT NULL UNIQUE,
        "loginPhoneAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "packageId" TEXT,
        "packageName" TEXT,
        "packageAudience" "AppPackageAudience",
        "packageStatus" "AppPackageStatus",
        "packageExpiresAt" TIMESTAMP(3),
        "workspaceMode" "AppWorkspaceMode",
        "passwordSalt" TEXT NOT NULL,
        "passwordHash" TEXT NOT NULL,
        "otpCode" TEXT NOT NULL,
        "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "isSeeded" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdByUserId" TEXT,
        "lastLoginAt" TIMESTAMP(3),
        "lastOtpSentAt" TIMESTAMP(3)
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS "AppAuthUser_tenantId_idx" ON "AppAuthUser"("tenantId");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "AppAuthUser_role_idx" ON "AppAuthUser"("role");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "AppAuthUser_assignedRole_idx" ON "AppAuthUser"("assignedRole");`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "AppAuthChallenge" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "AppAuthUser"("id") ON DELETE CASCADE,
        "phone" TEXT NOT NULL,
        "codeHash" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "consumedAt" TIMESTAMP(3),
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "deliveryMode" TEXT NOT NULL
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS "AppAuthChallenge_userId_idx" ON "AppAuthChallenge"("userId");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "AppAuthChallenge_phone_idx" ON "AppAuthChallenge"("phone");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "AppAuthChallenge_expiresAt_idx" ON "AppAuthChallenge"("expiresAt");`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "AppPasswordResetToken" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "AppAuthUser"("id") ON DELETE CASCADE,
        "tokenHash" TEXT NOT NULL UNIQUE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "usedAt" TIMESTAMP(3)
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS "AppPasswordResetToken_userId_idx" ON "AppPasswordResetToken"("userId");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "AppPasswordResetToken_expiresAt_idx" ON "AppPasswordResetToken"("expiresAt");`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "AppFreelancerWorkspace" (
        "userId" TEXT PRIMARY KEY REFERENCES "AppAuthUser"("id") ON DELETE CASCADE,
        "profile" JSONB NOT NULL,
        "verification" JSONB NOT NULL,
        "paymentDetails" JSONB NOT NULL,
        "payoutRequests" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "AppFreelancerService" (
        "id" TEXT PRIMARY KEY,
        "slug" TEXT NOT NULL UNIQUE,
        "ownerId" TEXT NOT NULL,
        "ownerName" TEXT NOT NULL,
        "ownerAlias" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "payload" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS "AppFreelancerService_ownerId_idx" ON "AppFreelancerService"("ownerId");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "AppFreelancerService_status_idx" ON "AppFreelancerService"("status");`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "AppConversation" (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "serviceId" TEXT NOT NULL,
        "serviceSlug" TEXT NOT NULL,
        "assignedFreelancerId" TEXT,
        "assignedFreelancerName" TEXT,
        "customerName" TEXT NOT NULL,
        "customerPhone" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "leadStatusId" TEXT NOT NULL,
        "payload" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS "AppConversation_tenantId_idx" ON "AppConversation"("tenantId");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "AppConversation_serviceId_idx" ON "AppConversation"("serviceId");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "AppConversation_assignedFreelancerId_idx" ON "AppConversation"("assignedFreelancerId");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "AppConversation_status_idx" ON "AppConversation"("status");`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "PlatformYouTubeConnection" (
        "id" TEXT PRIMARY KEY,
        "connectionKey" TEXT NOT NULL UNIQUE,
        "status" "PlatformYouTubeConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
        "channelId" TEXT,
        "channelName" TEXT,
        "channelHandle" TEXT,
        "refreshTokenCipher" TEXT,
        "accessTokenCipher" TEXT,
        "accessTokenExpiresAt" TIMESTAMP(3),
        "scope" TEXT,
        "connectedAt" TIMESTAMP(3),
        "lastValidatedAt" TIMESTAMP(3),
        "lastError" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "PlatformYouTubePublishJob" (
        "id" TEXT PRIMARY KEY,
        "assetId" TEXT NOT NULL,
        "draftId" TEXT NOT NULL,
        "tenantId" TEXT,
        "conversationId" TEXT NOT NULL,
        "freelancerId" TEXT,
        "freelancerName" TEXT,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "privacy" TEXT NOT NULL,
        "categoryId" TEXT,
        "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "madeForKids" BOOLEAN NOT NULL DEFAULT false,
        "status" "PlatformYouTubePublishJobStatus" NOT NULL DEFAULT 'PENDING',
        "sourceFilePath" TEXT NOT NULL,
        "sourceFileName" TEXT NOT NULL,
        "sourceMimeType" TEXT NOT NULL,
        "sourceSizeBytes" BIGINT,
        "youtubeVideoId" TEXT,
        "youtubeVideoUrl" TEXT,
        "lastError" TEXT,
        "retryCount" INTEGER NOT NULL DEFAULT 0,
        "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastAttemptAt" TIMESTAMP(3),
        "publishedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS "PlatformYouTubePublishJob_assetId_idx" ON "PlatformYouTubePublishJob"("assetId");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "PlatformYouTubePublishJob_draftId_idx" ON "PlatformYouTubePublishJob"("draftId");`);
    await client.query(`CREATE INDEX IF NOT EXISTS "PlatformYouTubePublishJob_status_idx" ON "PlatformYouTubePublishJob"("status");`);

    console.log("Database bootstrap completed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
