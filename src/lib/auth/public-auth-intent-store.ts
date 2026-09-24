import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

import type { PublicAuthIntentFlow, PublicAuthIntentRecord, PublicAuthIntentStatus } from "@/lib/auth/types";
import { normalizePhone } from "@/lib/auth/normalize";

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "public-auth-intents.json");
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const INTENT_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type PublicAuthIntentSnapshot = {
  intents: PublicAuthIntentRecord[];
};

let queue = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `intent-${randomBytes(6).toString("hex")}`;
}

function isExpired(intent: PublicAuthIntentRecord, now = Date.now()) {
  return new Date(intent.expiresAt).getTime() <= now;
}

function isActiveStatus(status: PublicAuthIntentStatus) {
  return status === "PENDING_WHATSAPP" || status === "OTP_ISSUED" || status === "PENDING_SUBSCRIPTION";
}

function isRecoverableForWhatsAppCommand(intent: PublicAuthIntentRecord, now = Date.now()) {
  if (intent.status === "VERIFIED" || intent.status === "SUPERSEDED") {
    return false;
  }

  const updatedAt = new Date(intent.updatedAt).getTime();
  return !Number.isNaN(updatedAt) && updatedAt > now - INTENT_RECOVERY_TTL_MS;
}

async function readSnapshot() {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<PublicAuthIntentSnapshot>;
    return {
      intents: Array.isArray(parsed.intents) ? parsed.intents : [],
    } satisfies PublicAuthIntentSnapshot;
  } catch {
    return {
      intents: [],
    } satisfies PublicAuthIntentSnapshot;
  }
}

async function writeSnapshot(snapshot: PublicAuthIntentSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
}

function normalizeSnapshot(snapshot: PublicAuthIntentSnapshot) {
  const now = Date.now();
  let changed = false;
  const intents = snapshot.intents.map((intent) => {
    if (isExpired(intent, now) && isActiveStatus(intent.status)) {
      changed = true;
      return {
        ...intent,
        status: "EXPIRED" as const,
        updatedAt: nowIso(),
      };
    }

    return intent;
  });

  return {
    changed,
    snapshot: {
      intents,
    } satisfies PublicAuthIntentSnapshot,
  };
}

function withStore<T>(action: (snapshot: PublicAuthIntentSnapshot) => Promise<{ result: T; snapshot?: PublicAuthIntentSnapshot }> | { result: T; snapshot?: PublicAuthIntentSnapshot }) {
  const run = async () => {
    const initial = await readSnapshot();
    const normalized = normalizeSnapshot(initial);
    if (normalized.changed) {
      await writeSnapshot(normalized.snapshot);
    }

    const outcome = await action(normalized.snapshot);
    if (outcome.snapshot) {
      await writeSnapshot(outcome.snapshot);
    }

    return outcome.result;
  };

  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function createPublicAuthIntent(input: {
  flow: PublicAuthIntentFlow;
  phone: string;
  displayName?: string | null;
  email?: string | null;
  packageId?: string | null;
  salesReferralCode?: string | null;
  redirectTo?: string | null;
  userId?: string | null;
}) {
  const phone = normalizePhone(input.phone);

  return withStore((snapshot) => {
    const createdAt = nowIso();
    const intent: PublicAuthIntentRecord = {
      id: makeId(),
      flow: input.flow,
      status: "PENDING_WHATSAPP",
      phone,
      displayName: input.displayName?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      packageId: input.packageId?.trim() || null,
      salesReferralCode: input.salesReferralCode?.trim().toUpperCase() || null,
      redirectTo: input.redirectTo?.trim() || null,
      userId: input.userId?.trim() || null,
      challengeId: null,
      challengeIssuedAt: null,
      whatsappVerifiedAt: null,
      completedAt: null,
      expiresAt: new Date(Date.now() + INTENT_TTL_MS).toISOString(),
      createdAt,
      updatedAt: createdAt,
    };

    const intents = snapshot.intents.map((existing) => {
      if (existing.phone === phone && isActiveStatus(existing.status)) {
        return {
          ...existing,
          status: "SUPERSEDED" as const,
          updatedAt: createdAt,
        };
      }

      return existing;
    });

    return {
      result: intent,
      snapshot: {
        intents: [intent, ...intents],
      },
    };
  });
}

export async function getPublicAuthIntentById(intentId: string) {
  return withStore((snapshot) => ({
    result: snapshot.intents.find((intent) => intent.id === intentId) ?? null,
  }));
}

export async function getLatestActivePublicAuthIntentByPhone(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  return withStore((snapshot) => ({
    result:
      snapshot.intents.find((intent) => intent.phone === normalizedPhone && isActiveStatus(intent.status) && !isExpired(intent)) ?? null,
  }));
}

export async function getLatestRecoverablePublicAuthIntentByPhone(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  return withStore((snapshot) => ({
    result:
      snapshot.intents
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .find((intent) => intent.phone === normalizedPhone && isRecoverableForWhatsAppCommand(intent)) ?? null,
  }));
}

export async function markPublicAuthIntentOtpIssued(input: {
  intentId: string;
  challengeId: string;
  userId?: string | null;
  whatsappVerifiedAt?: string | null;
}) {
  return withStore((snapshot) => {
    const updatedAt = nowIso();
    const intents = snapshot.intents.map((intent) =>
      intent.id === input.intentId
        ? {
            ...intent,
            status: "OTP_ISSUED" as const,
            userId: input.userId?.trim() || intent.userId,
            challengeId: input.challengeId,
            challengeIssuedAt: updatedAt,
            whatsappVerifiedAt: input.whatsappVerifiedAt !== undefined ? input.whatsappVerifiedAt : (intent.whatsappVerifiedAt ?? null),
            expiresAt: new Date(Date.now() + INTENT_TTL_MS).toISOString(),
            updatedAt,
          }
        : intent,
    );
    const updatedIntent = intents.find((intent) => intent.id === input.intentId) ?? null;

    return {
      result: updatedIntent,
      snapshot: {
        intents,
      },
    };
  });
}

export async function markPublicAuthIntentWhatsAppVerified(intentId: string) {
  return withStore((snapshot) => {
    const updatedAt = nowIso();
    const intents = snapshot.intents.map((intent) =>
      intent.id === intentId
        ? {
            ...intent,
            whatsappVerifiedAt: updatedAt,
            updatedAt,
          }
        : intent,
    );
    const updatedIntent = intents.find((intent) => intent.id === intentId) ?? null;

    return {
      result: updatedIntent,
      snapshot: {
        intents,
      },
    };
  });
}

export async function markPublicAuthIntentVerified(intentId: string) {
  return withStore((snapshot) => {
    const updatedAt = nowIso();
    const intents = snapshot.intents.map((intent) =>
      intent.id === intentId
        ? {
            ...intent,
            status: "VERIFIED" as const,
            completedAt: updatedAt,
            updatedAt,
          }
        : intent,
    );
    const updatedIntent = intents.find((intent) => intent.id === intentId) ?? null;

    return {
      result: updatedIntent,
      snapshot: {
        intents,
      },
    };
  });
}

export async function markPublicAuthIntentPendingSubscription(intentId: string) {
  return withStore((snapshot) => {
    const updatedAt = nowIso();
    const intents = snapshot.intents.map((intent) =>
      intent.id === intentId
        ? {
            ...intent,
            status: "PENDING_SUBSCRIPTION" as const,
            updatedAt,
          }
        : intent,
    );
    const updatedIntent = intents.find((intent) => intent.id === intentId) ?? null;

    return {
      result: updatedIntent,
      snapshot: {
        intents,
      },
    };
  });
}

export async function listRecentPublicAuthIntents(limit = 12) {
  return withStore((snapshot) => ({
    result: snapshot.intents
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(1, limit)),
  }));
}

export async function getPublicAuthIntentOverview() {
  return withStore((snapshot) => {
    const intents = snapshot.intents.slice();

    const counts = intents.reduce(
      (summary, intent) => {
        summary.total += 1;
        summary[intent.status] += 1;
        return summary;
      },
      {
        total: 0,
        PENDING_WHATSAPP: 0,
        OTP_ISSUED: 0,
        PENDING_SUBSCRIPTION: 0,
        VERIFIED: 0,
        EXPIRED: 0,
        SUPERSEDED: 0,
      } as Record<"total" | PublicAuthIntentStatus, number>,
    );

    return {
      result: counts,
    };
  });
}
