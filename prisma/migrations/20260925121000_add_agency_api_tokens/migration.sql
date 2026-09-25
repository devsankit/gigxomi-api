CREATE TABLE IF NOT EXISTS "AppAgencyApiToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY['team_portfolio:read']::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "AppAgencyApiToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppAgencyApiToken_tokenHash_key" ON "AppAgencyApiToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "AppAgencyApiToken_tenantId_idx" ON "AppAgencyApiToken"("tenantId");
CREATE INDEX IF NOT EXISTS "AppAgencyApiToken_tokenHash_idx" ON "AppAgencyApiToken"("tokenHash");
