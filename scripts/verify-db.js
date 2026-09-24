const CORE_REQUIRED_TABLES = [
  "AppAuthUser",
  "AppAuthChallenge",
  "AppPasswordResetToken",
  "AppFreelancerWorkspace",
  "AppFreelancerService",
  "AppConversation",
  "AppPublishingDraft",
  "meta_conversion_events",
  "PlatformYouTubeConnection",
  "PlatformYouTubePublishJob",
];

const SALES_OS_REQUIRED_TABLES = [
  "SalesSettings",
  "SalesAgentGroup",
  "SalesAgentProfile",
  "SalesLeadAssignment",
  "SalesLeadPoolItem",
  "SalesDeal",
  "SalesCommissionRule",
  "SalesEarning",
  "SalesPayout",
  "SalesReferralCode",
  "SalesReferralEvent",
  "SalesGoal",
  "SalesReward",
  "SalesAnnouncement",
  "SalesMessageThread",
  "SalesActivityLog",
  "SalesMobileDevice",
  "SalesMobileCall",
  "SalesMobileOfflineEvent",
  "SalesMobileLeadPack",
  "SalesTrainingCourse",
  "SalesTrainingModule",
  "SalesTrainingLesson",
  "SalesTrainingProgress",
  "SalesQuizAttempt",
  "SalesMockCallAttempt",
  "SalesUnlockRule",
  "SalesAgentLevel",
  "SalesLearningPost",
  "SalesLearningPostReaction",
  "SalesWebinar",
  "SalesWebinarInvite",
  "SalesLeadTimelineEntry",
  "SalesRoundRobinRule",
];

const REQUIRED_TABLES = [...CORE_REQUIRED_TABLES, ...SALES_OS_REQUIRED_TABLES];

function decodePrismaPostgresUrl(databaseUrl) {
  if (!databaseUrl.startsWith("prisma+postgres://")) {
    return databaseUrl;
  }

  const parsed = new URL(databaseUrl);
  const apiKey = parsed.searchParams.get("api_key")?.trim();
  if (!apiKey) {
    throw new Error("DATABASE_URL is missing the Prisma Postgres api_key query parameter.");
  }

  const encodedPayload = apiKey.includes(".") ? apiKey.split(".")[1] : apiKey;
  const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (!decoded.databaseUrl?.trim()) {
    throw new Error("DATABASE_URL api_key did not include a direct databaseUrl.");
  }

  return decoded.databaseUrl.trim();
}

function parseDbConfig(rawUrl) {
  const parsed = new URL(decodePrismaPostgresUrl(rawUrl));
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
  const { Pool } = await import("pg");
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const pool = new Pool(parseDbConfig(rawUrl));

  try {
    const connection = await pool.connect();
    connection.release();

    const tablesResult = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const existingTables = tablesResult.rows.map((row) => row.tablename);
    const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.includes(table));
    const conversionColumns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'SalesLeadPoolItem' AND column_name = 'conversationId'");
    const conversionLinkReady = conversionColumns.rowCount === 1;

    const countTables = [
      "AppAuthUser",
      "AppFreelancerWorkspace",
      "AppFreelancerService",
      "AppConversation",
      "AppPublishingDraft",
      "SalesAgentProfile",
      "SalesLeadAssignment",
      "SalesLeadPoolItem",
      "SalesDeal",
      "SalesMobileDevice",
      "SalesSettings",
    ];

    const counts = {};
    for (const table of countTables.filter((table) => existingTables.includes(table))) {
      const result = await pool.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      counts[table] = result.rows[0]?.count ?? 0;
    }

    console.log(JSON.stringify({ ok: missingTables.length === 0 && conversionLinkReady, existingTables, missingTables, conversionLinkReady, counts }, null, 2));

    if (missingTables.length || !conversionLinkReady) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
