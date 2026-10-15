import "server-only";

import { prisma } from "@/lib/prisma";

export type GlobalAiAutoReplySettings = {
  enabled: boolean;
  updatedAt: string;
  updatedById: string | null;
  updatedByName: string | null;
};

export async function getGlobalAiAutoReplySettings(): Promise<GlobalAiAutoReplySettings> {
  const settings = await (prisma as any).salesSettings.upsert({
    where: { id: "sales-settings" },
    update: {},
    create: { id: "sales-settings" },
    select: {
      aiAutoReplyEnabled: true,
      aiAutoReplyUpdatedById: true,
      aiAutoReplyUpdatedByName: true,
      updatedAt: true,
    },
  });

  return {
    enabled: settings.aiAutoReplyEnabled ?? true,
    updatedAt: settings.updatedAt.toISOString(),
    updatedById: settings.aiAutoReplyUpdatedById ?? null,
    updatedByName: settings.aiAutoReplyUpdatedByName ?? null,
  };
}

export async function setGlobalAiAutoReplyEnabled(input: {
  enabled: boolean;
  updatedById: string;
  updatedByName: string;
}): Promise<GlobalAiAutoReplySettings> {
  const settings = await (prisma as any).salesSettings.upsert({
    where: { id: "sales-settings" },
    update: {
      aiAutoReplyEnabled: input.enabled,
      aiAutoReplyUpdatedById: input.updatedById,
      aiAutoReplyUpdatedByName: input.updatedByName,
    },
    create: {
      id: "sales-settings",
      aiAutoReplyEnabled: input.enabled,
      aiAutoReplyUpdatedById: input.updatedById,
      aiAutoReplyUpdatedByName: input.updatedByName,
    },
    select: {
      aiAutoReplyEnabled: true,
      aiAutoReplyUpdatedById: true,
      aiAutoReplyUpdatedByName: true,
      updatedAt: true,
    },
  });

  return {
    enabled: settings.aiAutoReplyEnabled ?? input.enabled,
    updatedAt: settings.updatedAt.toISOString(),
    updatedById: settings.aiAutoReplyUpdatedById ?? input.updatedById,
    updatedByName: settings.aiAutoReplyUpdatedByName ?? input.updatedByName,
  };
}
