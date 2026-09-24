import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export type SubscriptionReminderSettings = {
  enabled: boolean;
  reminderDays: number[];
  updatedAt: string | null;
};

type SubscriptionReminderSnapshot = {
  settings: SubscriptionReminderSettings;
};

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "subscription-reminder-settings.json");

const DEFAULT_SETTINGS: SubscriptionReminderSettings = {
  enabled: true,
  reminderDays: [5, 4, 3, 2, 1, 0],
  updatedAt: null,
};

function normalizeReminderDays(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      values
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 30),
    ),
  ).sort((left, right) => right - left);
}

async function readSnapshot(): Promise<SubscriptionReminderSnapshot> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SubscriptionReminderSnapshot>;
    const settings = parsed.settings ?? DEFAULT_SETTINGS;
    return {
      settings: {
        enabled: settings.enabled !== false,
        reminderDays: normalizeReminderDays(settings.reminderDays).length ? normalizeReminderDays(settings.reminderDays) : DEFAULT_SETTINGS.reminderDays,
        updatedAt: typeof settings.updatedAt === "string" ? settings.updatedAt : null,
      },
    };
  } catch {
    return { settings: DEFAULT_SETTINGS };
  }
}

async function writeSnapshot(snapshot: SubscriptionReminderSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function getSubscriptionReminderSettings() {
  const snapshot = await readSnapshot();
  return snapshot.settings;
}

export async function updateSubscriptionReminderSettings(input: {
  enabled?: boolean;
  reminderDays?: string | number[];
}) {
  const current = await readSnapshot();
  const reminderDays = normalizeReminderDays(input.reminderDays);
  const nextSettings: SubscriptionReminderSettings = {
    enabled: input.enabled ?? current.settings.enabled,
    reminderDays: reminderDays.length ? reminderDays : current.settings.reminderDays,
    updatedAt: new Date().toISOString(),
  };

  await writeSnapshot({
    settings: nextSettings,
  });

  return nextSettings;
}
