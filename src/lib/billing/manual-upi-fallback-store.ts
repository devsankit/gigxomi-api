import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

import { buildUpiPaymentUri, getManualUpiAdminConfig } from "@/lib/billing/manual-upi-config-service";
import { companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";

type ManualUpiFallbackPaymentMode = "UPI_QR" | "SUPPORT_ONLY";
type ManualUpiFallbackPaymentStatus = "PENDING" | "INITIATED" | "SUCCESS" | "FAILED" | "CANCELLED" | "EXPIRED";

export type ManualUpiFallbackPaymentRecord = {
  id: string;
  userId: string | null;
  intentId: string | null;
  packageId: string;
  packageName: string;
  packageAudience: "FREELANCER" | "AGENCY";
  amount: number;
  currency: string;
  userDisplayName: string;
  userPhone: string;
  paymentMode: ManualUpiFallbackPaymentMode;
  upiId: string;
  payeeName: string;
  upiUri: string;
  paymentReference: string;
  supportWhatsApp: string;
  instructions: string;
  status: ManualUpiFallbackPaymentStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

type ManualUpiFallbackSnapshot = {
  payments: ManualUpiFallbackPaymentRecord[];
};

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "manual-upi-fallback-payments.json");
const PAYMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let queue = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `manual-fallback-${randomBytes(10).toString("hex")}`;
}

function isPendingStatus(status: ManualUpiFallbackPaymentStatus) {
  return status === "PENDING" || status === "INITIATED";
}

function isExpired(payment: ManualUpiFallbackPaymentRecord, now = Date.now()) {
  return new Date(payment.expiresAt).getTime() <= now;
}

async function readSnapshot() {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ManualUpiFallbackSnapshot>;
    return {
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
    } satisfies ManualUpiFallbackSnapshot;
  } catch {
    return {
      payments: [],
    } satisfies ManualUpiFallbackSnapshot;
  }
}

async function writeSnapshot(snapshot: ManualUpiFallbackSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
}

function normalizeSnapshot(snapshot: ManualUpiFallbackSnapshot) {
  const now = Date.now();
  let changed = false;

  const payments = snapshot.payments.map((payment) => {
    if (isPendingStatus(payment.status) && isExpired(payment, now)) {
      changed = true;
      return {
        ...payment,
        status: "EXPIRED" as const,
        updatedAt: nowIso(),
      };
    }

    return payment;
  });

  return {
    changed,
    snapshot: {
      payments,
    } satisfies ManualUpiFallbackSnapshot,
  };
}

function withStore<T>(
  action: (snapshot: ManualUpiFallbackSnapshot) => Promise<{ result: T; snapshot?: ManualUpiFallbackSnapshot }> | { result: T; snapshot?: ManualUpiFallbackSnapshot },
) {
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

function buildFallbackPaymentPath(id: string) {
  return `/payment/${id}`;
}

function defaultInstructions() {
  return "Pay the exact package amount, then send the payment screenshot or UTR on WhatsApp for approval.";
}

function trimValue(value: string | null | undefined) {
  return value?.trim() || "";
}

export async function createManualUpiFallbackPayment(input: {
  amount: number;
  currency?: string | null;
  intentId?: string | null;
  packageAudience: "FREELANCER" | "AGENCY";
  packageId: string;
  packageName: string;
  paymentReference?: string | null;
  userDisplayName: string;
  userId?: string | null;
  userPhone: string;
}) {
  const manualConfig = await getManualUpiAdminConfig().catch(() => null);
  const amount = Number.isFinite(input.amount) ? input.amount : 0;
  const currency = trimValue(input.currency) || "INR";
  const paymentReference = trimValue(input.paymentReference) || `gx-upi-${randomBytes(6).toString("hex")}`;
  const supportWhatsApp = manualConfig?.settings.supportWhatsApp || companyKnowledgeBase.supportPhoneE164;
  const instructions = manualConfig?.settings.instructions || defaultInstructions();
  const upiId = manualConfig?.readyForPayments ? manualConfig.settings.upiId : "";
  const payeeName = manualConfig?.readyForPayments ? manualConfig.settings.payeeName : "";
  const upiUri =
    upiId && payeeName
      ? buildUpiPaymentUri({
          amount,
          currency,
          note: `Gigxomi ${input.packageName} ${paymentReference}`.slice(0, 80),
          payeeName,
          upiId,
          transactionReference: paymentReference,
        })
      : "";
  const createdAt = nowIso();
  const record: ManualUpiFallbackPaymentRecord = {
    id: makeId(),
    userId: trimValue(input.userId) || null,
    intentId: trimValue(input.intentId) || null,
    packageId: input.packageId,
    packageName: input.packageName,
    packageAudience: input.packageAudience,
    amount,
    currency,
    userDisplayName: input.userDisplayName,
    userPhone: input.userPhone,
    paymentMode: upiUri ? "UPI_QR" : "SUPPORT_ONLY",
    upiId,
    payeeName,
    upiUri,
    paymentReference,
    supportWhatsApp,
    instructions,
    status: "INITIATED",
    expiresAt: new Date(Date.now() + PAYMENT_TTL_MS).toISOString(),
    createdAt,
    updatedAt: createdAt,
  };

  return withStore((snapshot) => ({
    result: {
      payment: record,
      redirectUrl: buildFallbackPaymentPath(record.id),
    },
    snapshot: {
      payments: [record, ...snapshot.payments],
    },
  }));
}

export async function getManualUpiFallbackPaymentById(id: string) {
  return withStore((snapshot) => ({
    result: snapshot.payments.find((payment) => payment.id === id) ?? null,
  }));
}

export async function findPendingManualUpiFallbackPayment(input: {
  intentId?: string | null;
  packageId: string;
  userId?: string | null;
  userPhone?: string | null;
}) {
  const userId = trimValue(input.userId);
  const userPhone = trimValue(input.userPhone);
  const intentId = trimValue(input.intentId);

  return withStore((snapshot) => ({
    result:
      snapshot.payments.find((payment) => {
        if (payment.packageId !== input.packageId) {
          return false;
        }
        if (!isPendingStatus(payment.status) || isExpired(payment)) {
          return false;
        }
        if (userId && payment.userId === userId) {
          return true;
        }
        if (intentId && payment.intentId === intentId) {
          return true;
        }
        if (userPhone && payment.userPhone === userPhone) {
          return true;
        }
        return false;
      }) ?? null,
  }));
}

export async function listPendingManualUpiFallbackPayments(input: {
  intentId?: string | null;
  userId?: string | null;
  userPhone?: string | null;
}) {
  const userId = trimValue(input.userId);
  const userPhone = trimValue(input.userPhone);
  const intentId = trimValue(input.intentId);

  return withStore((snapshot) => ({
    result: snapshot.payments.filter((payment) => {
      if (!isPendingStatus(payment.status) || isExpired(payment)) {
        return false;
      }
      if (userId && payment.userId === userId) {
        return true;
      }
      if (intentId && payment.intentId === intentId) {
        return true;
      }
      if (userPhone && payment.userPhone === userPhone) {
        return true;
      }
      return false;
    }),
  }));
}
