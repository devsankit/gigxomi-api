import "server-only";

import path from "node:path";
import { readFile } from "node:fs/promises";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type SessionDefaults = {
  userId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
};

export type FreelancerMonetizationPlan = "STANDARD_COMMISSION" | "SUBSCRIPTION_MONTHLY" | "SUBSCRIPTION_QUARTERLY" | "SUBSCRIPTION_YEARLY";
export type FreelancerProfileRecord = {
  fullName: string;
  displayName: string;
  phone: string;
  profession: string;
  languages: string[];
  englishLevel: string;
  bio: string;
  email: string;
  profileImageUrl: string;
  skills: string[];
  categories: string[];
  experience: string;
  portfolioLinks: string[];
  availability: string;
  pricing: string;
  preferredWorkType: string;
  location: string;
  timezone: string;
  status: "DRAFT" | "COMPLETED";
  updatedAt: string | null;
};
export type FreelancerVerificationRecord = { documentType: string; documentNumber: string; address: string; status: "NOT_SUBMITTED" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"; reviewRule: string; submittedAt: string | null; updatedAt: string | null };
export type FreelancerPaymentDetailsRecord = { bankAccountName: string; bankAccountNumber: string; bankIfsc: string; upiId: string; monetizationPlan: FreelancerMonetizationPlan; commissionRule: string; updatedAt: string | null };
export type FreelancerPayoutRequestRecord = { id: string; amount: number; note: string; status: "REQUESTED" | "UNDER_REVIEW" | "APPROVED" | "PAID" | "REJECTED"; createdAt: string };
export type FreelancerWorkspaceRecord = { profile: FreelancerProfileRecord; verification: FreelancerVerificationRecord; paymentDetails: FreelancerPaymentDetailsRecord; payoutRequests: FreelancerPayoutRequestRecord[] };

const LEGACY_STORE_PATH = path.join(process.cwd(), ".gigxomi", "freelancer-workspace-store.json");
let bootstrapPromise: Promise<void> | null = null;
type JsonStoredValue = Prisma.JsonValue;

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function commissionRuleForPlan(plan: FreelancerMonetizationPlan) {
  return plan === "STANDARD_COMMISSION" ? "30% commission" : "5% transaction fee";
}

function normalizeLanguages(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizePlan(value: unknown): FreelancerMonetizationPlan {
  return value === "SUBSCRIPTION_MONTHLY" || value === "SUBSCRIPTION_QUARTERLY" || value === "SUBSCRIPTION_YEARLY" ? value : "STANDARD_COMMISSION";
}

function defaultWorkspaceRecord(defaults: SessionDefaults): FreelancerWorkspaceRecord {
  return {
    profile: {
      fullName: defaults.displayName ?? "",
      displayName: defaults.displayName ?? "",
      phone: defaults.phone ?? "",
      profession: "",
      languages: [],
      englishLevel: "",
      bio: "",
      email: defaults.email ?? "",
      profileImageUrl: "",
      skills: [],
      categories: [],
      experience: "",
      portfolioLinks: [],
      availability: "",
      pricing: "",
      preferredWorkType: "",
      location: "",
      timezone: "",
      status: "DRAFT",
      updatedAt: null,
    },
    verification: { documentType: "aadhaar", documentNumber: "", address: "", status: "NOT_SUBMITTED", reviewRule: "Verification + admin approval required before public listing", submittedAt: null, updatedAt: null },
    paymentDetails: { bankAccountName: defaults.displayName ?? "", bankAccountNumber: "", bankIfsc: "", upiId: defaults.phone ? `${defaults.phone}@upi` : "", monetizationPlan: "STANDARD_COMMISSION", commissionRule: commissionRuleForPlan("STANDARD_COMMISSION"), updatedAt: null },
    payoutRequests: [],
  };
}

function normalizeRecord(value: Partial<FreelancerWorkspaceRecord> | undefined, defaults: SessionDefaults): FreelancerWorkspaceRecord {
  const fallback = defaultWorkspaceRecord(defaults);
  const plan = normalizePlan(value?.paymentDetails?.monetizationPlan);
  return {
    profile: {
      fullName: value?.profile?.fullName ?? fallback.profile.fullName,
      displayName: value?.profile?.displayName ?? fallback.profile.displayName,
      phone: value?.profile?.phone ?? fallback.profile.phone,
      profession: value?.profile?.profession ?? fallback.profile.profession,
      languages: normalizeLanguages(value?.profile?.languages ?? fallback.profile.languages),
      englishLevel: value?.profile?.englishLevel ?? fallback.profile.englishLevel,
      bio: value?.profile?.bio ?? fallback.profile.bio,
      email: value?.profile?.email ?? fallback.profile.email,
      profileImageUrl: value?.profile?.profileImageUrl ?? fallback.profile.profileImageUrl,
      skills: normalizeStringList(value?.profile?.skills ?? fallback.profile.skills),
      categories: normalizeStringList(value?.profile?.categories ?? fallback.profile.categories),
      experience: value?.profile?.experience ?? fallback.profile.experience,
      portfolioLinks: normalizeStringList(value?.profile?.portfolioLinks ?? fallback.profile.portfolioLinks),
      availability: value?.profile?.availability ?? fallback.profile.availability,
      pricing: value?.profile?.pricing ?? fallback.profile.pricing,
      preferredWorkType: value?.profile?.preferredWorkType ?? fallback.profile.preferredWorkType,
      location: value?.profile?.location ?? fallback.profile.location,
      timezone: value?.profile?.timezone ?? fallback.profile.timezone,
      status: value?.profile?.status === "COMPLETED" ? "COMPLETED" : "DRAFT",
      updatedAt: value?.profile?.updatedAt ?? fallback.profile.updatedAt,
    },
    verification: {
      documentType: value?.verification?.documentType ?? fallback.verification.documentType,
      documentNumber: value?.verification?.documentNumber ?? fallback.verification.documentNumber,
      address: value?.verification?.address ?? fallback.verification.address,
      status: value?.verification?.status === "SUBMITTED" || value?.verification?.status === "UNDER_REVIEW" || value?.verification?.status === "APPROVED" || value?.verification?.status === "REJECTED" ? value.verification.status : fallback.verification.status,
      reviewRule: value?.verification?.reviewRule ?? fallback.verification.reviewRule,
      submittedAt: value?.verification?.submittedAt ?? fallback.verification.submittedAt,
      updatedAt: value?.verification?.updatedAt ?? fallback.verification.updatedAt,
    },
    paymentDetails: {
      bankAccountName: value?.paymentDetails?.bankAccountName ?? fallback.paymentDetails.bankAccountName,
      bankAccountNumber: value?.paymentDetails?.bankAccountNumber ?? fallback.paymentDetails.bankAccountNumber,
      bankIfsc: value?.paymentDetails?.bankIfsc ?? fallback.paymentDetails.bankIfsc,
      upiId: value?.paymentDetails?.upiId ?? fallback.paymentDetails.upiId,
      monetizationPlan: plan,
      commissionRule: commissionRuleForPlan(plan),
      updatedAt: value?.paymentDetails?.updatedAt ?? fallback.paymentDetails.updatedAt,
    },
    payoutRequests: Array.isArray(value?.payoutRequests)
      ? value.payoutRequests.map((request) => ({ id: request.id ?? makeId("payout"), amount: Number(request.amount ?? 0), note: request.note ?? "", status: request.status === "UNDER_REVIEW" || request.status === "APPROVED" || request.status === "PAID" || request.status === "REJECTED" ? request.status : "REQUESTED", createdAt: request.createdAt ?? nowIso() }))
      : fallback.payoutRequests,
  };
}

async function readLegacySnapshot() {
  try {
    const contents = await readFile(LEGACY_STORE_PATH, "utf8");
    return JSON.parse(contents) as { freelancers?: Record<string, FreelancerWorkspaceRecord> };
  } catch {
    return null;
  }
}

async function ensureBootstrapped() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      if ((await prisma.appFreelancerWorkspace.count()) > 0) return;
      const legacy = await readLegacySnapshot();
      for (const [userId, record] of Object.entries(legacy?.freelancers ?? {})) {
        const normalized = normalizeRecord(record, { userId, displayName: null, email: null, phone: null });
        await prisma.appFreelancerWorkspace.upsert({
          where: { userId },
          create: {
            userId,
            profile: normalized.profile as Prisma.InputJsonValue,
            verification: normalized.verification as Prisma.InputJsonValue,
            paymentDetails: normalized.paymentDetails as Prisma.InputJsonValue,
            payoutRequests: normalized.payoutRequests as Prisma.InputJsonValue,
          },
          update: {},
        });
      }
    })();
  }
  return bootstrapPromise;
}

async function getStoredWorkspace(userId: string, defaults: SessionDefaults) {
  await ensureBootstrapped();
  const existing = await prisma.appFreelancerWorkspace.findUnique({ where: { userId } });
  if (!existing) {
    const normalized = normalizeRecord(undefined, defaults);
    return prisma.appFreelancerWorkspace.create({
      data: {
        userId,
        profile: normalized.profile as Prisma.InputJsonValue,
        verification: normalized.verification as Prisma.InputJsonValue,
        paymentDetails: normalized.paymentDetails as Prisma.InputJsonValue,
        payoutRequests: [] as Prisma.InputJsonValue,
      },
    });
  }
  return existing;
}

function fromStoredWorkspace(stored: { profile: JsonStoredValue; verification: JsonStoredValue; paymentDetails: JsonStoredValue; payoutRequests: JsonStoredValue }, defaults: SessionDefaults) {
  return normalizeRecord(
    { profile: stored.profile as FreelancerProfileRecord, verification: stored.verification as FreelancerVerificationRecord, paymentDetails: stored.paymentDetails as FreelancerPaymentDetailsRecord, payoutRequests: stored.payoutRequests as FreelancerPayoutRequestRecord[] },
    defaults,
  );
}

async function saveWorkspace(userId: string, workspace: FreelancerWorkspaceRecord) {
  return prisma.appFreelancerWorkspace.upsert({
    where: { userId },
    create: {
      userId,
      profile: workspace.profile as Prisma.InputJsonValue,
      verification: workspace.verification as Prisma.InputJsonValue,
      paymentDetails: workspace.paymentDetails as Prisma.InputJsonValue,
      payoutRequests: workspace.payoutRequests as Prisma.InputJsonValue,
    },
    update: {
      profile: workspace.profile as Prisma.InputJsonValue,
      verification: workspace.verification as Prisma.InputJsonValue,
      paymentDetails: workspace.paymentDetails as Prisma.InputJsonValue,
      payoutRequests: workspace.payoutRequests as Prisma.InputJsonValue,
    },
  });
}

export async function getFreelancerWorkspaceState(userId: string, defaults: SessionDefaults) {
  return fromStoredWorkspace(await getStoredWorkspace(userId, defaults), defaults);
}

export async function ensureFreelancerWorkspace(userId: string, defaults: SessionDefaults) {
  await getStoredWorkspace(userId, defaults);
}

export async function upsertFreelancerProfile(userId: string, defaults: SessionDefaults, input: Partial<FreelancerProfileRecord>) {
  const current = fromStoredWorkspace(await getStoredWorkspace(userId, defaults), defaults);
  const languages = normalizeLanguages(input.languages ?? current.profile.languages);
  current.profile = {
    ...current.profile,
    fullName: input.fullName?.trim() ?? current.profile.fullName,
    displayName: input.displayName?.trim() ?? input.fullName?.trim() ?? current.profile.displayName,
    phone: input.phone?.trim() ?? current.profile.phone,
    profession: input.profession?.trim() ?? current.profile.profession,
    languages,
    englishLevel: input.englishLevel?.trim() ?? current.profile.englishLevel,
    bio: input.bio?.trim() ?? current.profile.bio,
    email: input.email?.trim() ?? current.profile.email,
    profileImageUrl: input.profileImageUrl?.trim() ?? current.profile.profileImageUrl,
    skills: input.skills !== undefined ? normalizeStringList(input.skills) : current.profile.skills,
    categories: input.categories !== undefined ? normalizeStringList(input.categories) : current.profile.categories,
    experience: input.experience?.trim() ?? current.profile.experience,
    portfolioLinks: input.portfolioLinks !== undefined ? normalizeStringList(input.portfolioLinks) : current.profile.portfolioLinks,
    availability: input.availability?.trim() ?? current.profile.availability,
    pricing: input.pricing?.trim() ?? current.profile.pricing,
    preferredWorkType: input.preferredWorkType?.trim() ?? current.profile.preferredWorkType,
    location: input.location?.trim() ?? current.profile.location,
    timezone: input.timezone?.trim() ?? current.profile.timezone,
    status: input.fullName || input.profession || input.bio || languages.length || input.skills || input.categories || input.portfolioLinks || input.pricing || input.availability ? "COMPLETED" : current.profile.status,
    updatedAt: nowIso(),
  };
  await saveWorkspace(userId, current);
  return current;
}

export async function submitFreelancerVerification(userId: string, defaults: SessionDefaults, input: Partial<FreelancerVerificationRecord>) {
  const current = fromStoredWorkspace(await getStoredWorkspace(userId, defaults), defaults);
  current.verification = {
    ...current.verification,
    documentType: input.documentType?.trim() ?? current.verification.documentType,
    documentNumber: input.documentNumber?.trim() ?? current.verification.documentNumber,
    address: input.address?.trim() ?? current.verification.address,
    status: "SUBMITTED",
    submittedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await saveWorkspace(userId, current);
  return current;
}

export async function upsertFreelancerPaymentDetails(userId: string, defaults: SessionDefaults, input: Partial<FreelancerPaymentDetailsRecord>) {
  const current = fromStoredWorkspace(await getStoredWorkspace(userId, defaults), defaults);
  const monetizationPlan = normalizePlan(input.monetizationPlan ?? current.paymentDetails.monetizationPlan);
  current.paymentDetails = {
    ...current.paymentDetails,
    bankAccountName: input.bankAccountName?.trim() ?? current.paymentDetails.bankAccountName,
    bankAccountNumber: input.bankAccountNumber?.trim() ?? current.paymentDetails.bankAccountNumber,
    bankIfsc: input.bankIfsc?.trim() ?? current.paymentDetails.bankIfsc,
    upiId: input.upiId?.trim() ?? current.paymentDetails.upiId,
    monetizationPlan,
    commissionRule: commissionRuleForPlan(monetizationPlan),
    updatedAt: nowIso(),
  };
  await saveWorkspace(userId, current);
  return current;
}

export async function createFreelancerPayoutRequest(userId: string, defaults: SessionDefaults, input: { amount: number; note?: string }) {
  const current = fromStoredWorkspace(await getStoredWorkspace(userId, defaults), defaults);
  const payoutRequest: FreelancerPayoutRequestRecord = { id: makeId("payout"), amount: Number(input.amount ?? 0), note: input.note?.trim() ?? "", status: "REQUESTED", createdAt: nowIso() };
  current.payoutRequests = [payoutRequest, ...current.payoutRequests];
  await saveWorkspace(userId, current);
  return { workspace: current, payoutRequest };
}
