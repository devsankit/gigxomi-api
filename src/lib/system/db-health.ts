import "server-only";

import { prisma } from "@/lib/prisma";

const REQUIRED_TABLES = [
  "AppAuthUser",
  "AppAuthChallenge",
  "AppPasswordResetToken",
  "AppFreelancerWorkspace",
  "AppFreelancerService",
  "AppConversation",
  "AppPublishingDraft",
  "PlatformYouTubeConnection",
  "PlatformYouTubePublishJob",
] as const;

export type DatabaseHealth = {
  ok: boolean;
  databaseUrlConfigured: boolean;
  reachable: boolean;
  requiredTables: string[];
  existingTables: string[];
  missingTables: string[];
  authUsers: number | null;
  freelancerWorkspaces: number | null;
  freelancerServices: number | null;
  conversations: number | null;
  error: string | null;
};

export async function getDatabaseHealth(): Promise<DatabaseHealth> {
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL?.trim());

  if (!databaseUrlConfigured) {
    return {
      ok: false,
      databaseUrlConfigured: false,
      reachable: false,
      requiredTables: [...REQUIRED_TABLES],
      existingTables: [],
      missingTables: [...REQUIRED_TABLES],
      authUsers: null,
      freelancerWorkspaces: null,
      freelancerServices: null,
      conversations: null,
      error: "DATABASE_URL is not configured.",
    };
  }

  try {
    const tableRows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `;

    const existingTables = tableRows.map((row) => row.tablename);
    const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.includes(table));

    const [authUsers, freelancerWorkspaces, freelancerServices, conversations] = await Promise.all([
      prisma.appAuthUser.count(),
      prisma.appFreelancerWorkspace.count(),
      prisma.appFreelancerService.count(),
      prisma.appConversation.count(),
    ]);

    return {
      ok: missingTables.length === 0,
      databaseUrlConfigured: true,
      reachable: true,
      requiredTables: [...REQUIRED_TABLES],
      existingTables,
      missingTables,
      authUsers,
      freelancerWorkspaces,
      freelancerServices,
      conversations,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      databaseUrlConfigured: true,
      reachable: false,
      requiredTables: [...REQUIRED_TABLES],
      existingTables: [],
      missingTables: [...REQUIRED_TABLES],
      authUsers: null,
      freelancerWorkspaces: null,
      freelancerServices: null,
      conversations: null,
      error: error instanceof Error ? error.message : "Database health check failed.",
    };
  }
}
