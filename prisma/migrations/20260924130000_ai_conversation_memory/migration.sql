CREATE TABLE IF NOT EXISTS "AiConversationMemoryMessage" (
  "scope" TEXT NOT NULL, "id" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("scope", "id")
);
CREATE INDEX IF NOT EXISTS "AiConversationMemoryMessage_scope_sourceId_idx" ON "AiConversationMemoryMessage" ("scope", "sourceId");
CREATE TABLE IF NOT EXISTS "AiConversationMemoryNode" (
  "scope" TEXT NOT NULL, "id" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("scope", "id")
);
CREATE TABLE IF NOT EXISTS "AiConversationMemoryCheckpoint" (
  "scope" TEXT PRIMARY KEY, "version" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
