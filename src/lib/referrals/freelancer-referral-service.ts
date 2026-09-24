import "server-only";

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/auth/normalize";

const STORE_ROOT = process.env.DATA_STORE_DIR
  ? path.resolve(process.env.DATA_STORE_DIR)
  : path.join(process.cwd(), ".gigxomi");

const REFERRALS_FILE = path.join(STORE_ROOT, "freelancer-referrals.json");

export type FreelancerReferralRecord = {
  freelancerId: string;
  referralCode: string;
  phone?: string | null;
  displayName?: string | null;
  clicks: number;
  referredBySalesAgentId?: string | null;
  referredBySalesAgentCode?: string | null;
  createdAt: string;
  updatedAt: string;
  referredAgencies: Array<{
    id: string;
    agencyUserId: string;
    agencyName: string;
    agencyPhone?: string | null;
    registeredAt: string;
    hasSubscribed: boolean;
    packageName?: string | null;
    packageAmount?: number;
    billingCycle?: "monthly" | "yearly";
    commissionEarned: number; // 10%
    salesCommissionEarned?: number; // 10% for sales agent if applicable
    status: "Joined" | "Active Subscriber" | "Commission Credited";
    lastPaymentAt?: string | null;
  }>;
};

type StoreData = {
  referrals: Record<string, FreelancerReferralRecord>; // keyed by referralCode
  byFreelancerId: Record<string, string>; // freelancerId -> referralCode
};

let memoryStore: StoreData | null = null;

async function ensureStoreLoaded(): Promise<StoreData> {
  if (memoryStore) return memoryStore;
  try {
    const raw = await readFile(REFERRALS_FILE, "utf8");
    memoryStore = JSON.parse(raw) as StoreData;
  } catch {
    memoryStore = { referrals: {}, byFreelancerId: {} };
  }
  return memoryStore;
}

async function persistStore(): Promise<void> {
  if (!memoryStore) return;
  try {
    await mkdir(STORE_ROOT, { recursive: true });
    await writeFile(REFERRALS_FILE, JSON.stringify(memoryStore, null, 2), "utf8");
  } catch (error) {
    console.error("[FREELANCER_REFERRALS] Failed to persist store:", error);
  }
}

export function generateFreelancerReferralCode(freelancerId: string, phone?: string | null): string {
  const digits = normalizePhone(phone ?? "").replace(/\D/g, "");
  if (digits.length >= 6) {
    return `GX${digits.slice(-6)}`;
  }
  const cleanId = freelancerId.replace(/^user-/, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `GX${cleanId.slice(0, 6) || "EDITOR"}`;
}

export async function getOrCreateFreelancerReferral(
  freelancerId: string,
  sessionUser?: { phone?: string | null; displayName?: string | null }
): Promise<FreelancerReferralRecord> {
  const store = await ensureStoreLoaded();
  let code = store.byFreelancerId[freelancerId];

  if (!code) {
    code = generateFreelancerReferralCode(freelancerId, sessionUser?.phone);
    // Ensure uniqueness
    let attempt = 0;
    let candidate = code;
    while (store.referrals[candidate] && store.referrals[candidate].freelancerId !== freelancerId) {
      attempt += 1;
      candidate = `${code}${attempt}`;
    }
    code = candidate;

    store.byFreelancerId[freelancerId] = code;
    store.referrals[code] = {
      freelancerId,
      referralCode: code,
      phone: sessionUser?.phone ?? null,
      displayName: sessionUser?.displayName ?? null,
      clicks: 0,
      referredBySalesAgentId: null,
      referredBySalesAgentCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      referredAgencies: [],
    };
    await persistStore();
  }

  return store.referrals[code];
}

export async function trackReferralClick(code: string): Promise<boolean> {
  const store = await ensureStoreLoaded();
  const normalized = code.trim().toUpperCase();
  const record = store.referrals[normalized];
  if (!record) return false;

  record.clicks += 1;
  record.updatedAt = new Date().toISOString();
  await persistStore();

  // Also record in Prisma if possible
  try {
    const activeCode = await prisma.salesReferralCode.findFirst({ where: { code: normalized } });
    if (activeCode) {
      await prisma.salesReferralEvent.create({
        data: {
          referralCodeId: activeCode.id,
          agentId: activeCode.agentId,
          eventType: "PRICING_VIEW",
          path: "/r/" + normalized,
        },
      });
    }
  } catch {}

  return true;
}

export async function recordReferralSignup(
  code: string,
  agencyUser: { id: string; displayName: string; phone?: string | null; email?: string | null }
): Promise<boolean> {
  const store = await ensureStoreLoaded();
  const normalized = code.trim().toUpperCase();
  const record = store.referrals[normalized];
  if (!record) return false;

  const exists = record.referredAgencies.some((agency) => agency.agencyUserId === agencyUser.id);
  if (exists) return true;

  record.referredAgencies.push({
    id: `ref-agency-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agencyUserId: agencyUser.id,
    agencyName: agencyUser.displayName || "Agency Partner",
    agencyPhone: agencyUser.phone ?? null,
    registeredAt: new Date().toISOString(),
    hasSubscribed: false,
    packageName: null,
    packageAmount: 0,
    commissionEarned: 0,
    status: "Joined",
  });
  record.updatedAt = new Date().toISOString();
  await persistStore();

  return true;
}

export async function recordReferralSubscription(
  agencyUserId: string,
  packageInfo: { packageName: string; amount: number; billingCycle?: "monthly" | "yearly" }
): Promise<{ awardedFreelancerId: string | null; commission: number }> {
  const store = await ensureStoreLoaded();
  const commissionRate = 0.10; // 10% commission
  const commission = Math.round(packageInfo.amount * commissionRate);

  for (const record of Object.values(store.referrals)) {
    const agencyItem = record.referredAgencies.find((agency) => agency.agencyUserId === agencyUserId);
    if (agencyItem) {
      agencyItem.hasSubscribed = true;
      agencyItem.packageName = packageInfo.packageName;
      agencyItem.packageAmount = packageInfo.amount;
      agencyItem.billingCycle = packageInfo.billingCycle || "monthly";
      agencyItem.commissionEarned += commission;
      agencyItem.status = "Commission Credited";
      agencyItem.lastPaymentAt = new Date().toISOString();

      if (record.referredBySalesAgentId) {
        agencyItem.salesCommissionEarned = (agencyItem.salesCommissionEarned || 0) + commission;
      }

      record.updatedAt = new Date().toISOString();
      await persistStore();

      // Credit to Freelancer's wallet entry if available
      try {
        await prisma.appFreelancerWalletEntry.create({
          data: {
            id: `wallet-ref-${Date.now()}`,
            freelancerId: record.freelancerId,
            tenantId: "tenant-gigxomi-platform",
            assignmentId: `ref-${agencyUserId}`,
            paymentRequestId: `pay-ref-${Date.now()}`,
            title: `10% Referral Commission - ${packageInfo.packageName} (${agencyItem.agencyName})`,
            grossAmount: commission,
            commissionPercent: 0,
            commissionAmount: 0,
            netAmount: commission,
            status: "AVAILABLE",
            source: "REFERRAL",
            availableAt: new Date(),
            metadata: {
              type: "REFERRAL_COMMISSION",
              agencyUserId,
              agencyName: agencyItem.agencyName,
              packageAmount: packageInfo.amount,
              billingCycle: packageInfo.billingCycle || "monthly",
            },
          },
        });
      } catch (err) {
        console.warn("[FREELANCER_REFERRALS] Wallet credit note: database skipped or already credited:", err);
      }

      return { awardedFreelancerId: record.freelancerId, commission };
    }
  }

  return { awardedFreelancerId: null, commission: 0 };
}

export async function getFreelancerReferralDashboard(
  freelancerId: string,
  sessionUser?: { phone?: string | null; displayName?: string | null }
) {
  const record = await getOrCreateFreelancerReferral(freelancerId, sessionUser);
  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://gigxomi.com").replace(/\/+$/, "");

  const totalCommissionEarned = record.referredAgencies.reduce((sum, item) => sum + (item.commissionEarned || 0), 0);
  const activeSubscribers = record.referredAgencies.filter((item) => item.hasSubscribed).length;
  const registeredAgencies = record.referredAgencies.length;

  const shareUrl = `${appBaseUrl}/r/${record.referralCode}`;
  const playStoreUrl = `https://play.google.com/store/apps/details?id=com.gigxomi.app&referrer=ref%3D${encodeURIComponent(record.referralCode)}`;

  return {
    ok: true,
    referralCode: record.referralCode,
    shareUrl,
    playStoreUrl,
    commissionRate: 10,
    metrics: {
      clicks: record.clicks,
      registeredAgencies,
      activeSubscribers,
      totalCommissionEarned,
      pendingCommission: 0,
      paidCommission: totalCommissionEarned,
    },
    commissionPlan: {
      monthlyCommissionPercent: 10,
      yearlyCommissionPercent: 10,
      description: "Earn flat 10% recurring commission on every Monthly or Yearly Agency Premium Plan purchased by your referred agencies.",
    },
    referredAgencies: record.referredAgencies.map((agency) => ({
      id: agency.id,
      agencyName: agency.agencyName,
      registeredAt: agency.registeredAt,
      hasSubscribed: agency.hasSubscribed,
      packageName: agency.packageName,
      commissionEarned: agency.commissionEarned,
      status: agency.status,
    })),
    salesAttribution: record.referredBySalesAgentId
      ? {
          referredBySalesAgent: record.referredBySalesAgentCode || "Sales Agent",
          salesCommissionRate: 10,
        }
      : null,
  };
}
