import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { OnboardingProgressRecord, OnboardingRole } from "@/lib/gigxomi/onboarding-types";

type StoreShape = {
  records: OnboardingProgressRecord[];
  updatedAt: string;
};

const STORE_DIR = path.join(process.cwd(), ".gigxomi");
const STORE_FILE = path.join(STORE_DIR, "onboarding-progress-store.json");

let queue = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      records: Array.isArray(parsed.records) ? parsed.records : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
    };
  } catch {
    return { records: [], updatedAt: nowIso() };
  }
}

async function writeStore(next: StoreShape) {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(next, null, 2), "utf8");
}

function withStore<T>(action: (store: StoreShape) => Promise<T> | T, persist = true) {
  const run = async () => {
    const store = await readStore();
    const result = await action(store);
    if (persist) {
      store.updatedAt = nowIso();
      await writeStore(store);
    }
    return result;
  };

  const next = queue.then(run, run);
  queue = next.then(() => undefined, () => undefined);
  return next;
}

function key(userId: string, role: OnboardingRole, checklistKey: string) {
  return `${userId}::${role}::${checklistKey}`;
}

export async function getOnboardingProgress(userId: string, role: OnboardingRole, checklistKey: string) {
  return withStore((store) => store.records.find((entry) => key(entry.userId, entry.role, entry.checklistKey) === key(userId, role, checklistKey)) ?? null, false);
}

export async function upsertOnboardingProgress(
  userId: string,
  role: OnboardingRole,
  checklistKey: string,
  patch: Partial<Omit<OnboardingProgressRecord, "id" | "userId" | "role" | "checklistKey" | "createdAt" | "updatedAt">>,
) {
  return withStore((store) => {
    const existing = store.records.find((entry) => key(entry.userId, entry.role, entry.checklistKey) === key(userId, role, checklistKey));
    const now = nowIso();

    if (!existing) {
      const created: OnboardingProgressRecord = {
        id: crypto.randomUUID(),
        userId,
        role,
        checklistKey,
        completedSteps: patch.completedSteps ?? [],
        skippedSteps: patch.skippedSteps ?? [],
        dismissed: patch.dismissed ?? false,
        completedAt: patch.completedAt ?? null,
        lastSeenStep: patch.lastSeenStep ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.records.push(created);
      return created;
    }

    existing.completedSteps = patch.completedSteps ?? existing.completedSteps;
    existing.skippedSteps = patch.skippedSteps ?? existing.skippedSteps;
    existing.dismissed = patch.dismissed ?? existing.dismissed;
    existing.completedAt = patch.completedAt ?? existing.completedAt;
    existing.lastSeenStep = patch.lastSeenStep ?? existing.lastSeenStep;
    existing.updatedAt = now;
    return existing;
  });
}

export async function resetOnboardingProgress(userId: string, role: OnboardingRole, checklistKey: string) {
  return withStore((store) => {
    const before = store.records.length;
    store.records = store.records.filter((entry) => key(entry.userId, entry.role, entry.checklistKey) !== key(userId, role, checklistKey));
    return before !== store.records.length;
  });
}
