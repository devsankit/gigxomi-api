import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, scryptSync } from "node:crypto";

import { Prisma } from "@prisma/client";

import { createInternalUser, ensureAuthStoreReady } from "@/lib/auth/store";
import type { AppRole } from "@/lib/auth/types";
import { listMobilePushTokens, sendMobilePushNotifications } from "@/lib/mobile-push-store";
import { prisma } from "@/lib/prisma";
import { buildSiteUrl } from "@/lib/seo/company-knowledge-base";

export type SalesAgentStatus = "PENDING" | "ACTIVE" | "SUSPENDED";
export type SalesLeadStage =
  | "NEW"
  | "ASSIGNED"
  | "CONTACTED"
  | "INTERESTED"
  | "WEBINAR_INVITED"
  | "WEBINAR_ATTENDED"
  | "FOLLOW_UP"
  | "NEGOTIATION"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "NOT_REACHABLE"
  | "RECYCLED"
  | "QUALIFIED"
  | "QUOTE_SENT"
  | "PAYMENT_PENDING"
  | "PAID"
  | "HANDOFF"
  | "CONVERTED_FREE"
  | "CLOSED"
  | "LOST";
export type SalesDealStatus = "DRAFT" | "PAYMENT_PENDING" | "PAID" | "HANDOFF" | "CLOSED" | "CANCELLED" | "REFUNDED";
export type SalesEarningStatus = "PENDING" | "APPROVED" | "PAID" | "REVERSED";
export type SalesPayoutStatus = "REQUESTED" | "APPROVED" | "PAID" | "REJECTED";
export type SalesCommissionRuleType = "FIXED" | "PERCENTAGE";
export type SalesCommissionScope = "ALL_AGENTS" | "AGENT_GROUP" | "INDIVIDUAL_AGENT";
export type SalesCommissionAppliesTo = "ALL_PACKAGES" | "PACKAGE" | "SERVICE" | "ONE_TIME_DEAL";
export type SalesLeadPoolStatus = "OPEN" | "CLAIMED" | "ARCHIVED";
export type SalesReferralEventType = "PRICING_VIEW" | "SIGNUP_STARTED" | "SIGNUP_VERIFIED" | "PAYMENT_STARTED" | "PAYMENT_SUCCESS" | "DEAL_CREATED";
export type SalesGoalMetric = "PAID_REVENUE" | "CLOSED_DEALS" | "REFERRAL_SIGNUPS" | "CONVERSION_RATE" | "LEADS_CLAIMED";
export type SalesGoalScope = "ALL_AGENTS" | "AGENT_GROUP" | "INDIVIDUAL_AGENT";

type SalesModuleSettings = {
  moduleEnabled: boolean;
  signupRequiresApproval: boolean;
  defaultCommissionPercent: number;
  payoutMinimum: number;
  enableAnnouncements: boolean;
  enableMessages: boolean;
  enableReferralLinks: boolean;
  enableTeams: boolean;
  enableEarnings: boolean;
  enablePayouts: boolean;
  enablePackageLinks: boolean;
  dashboardPrimaryColor: string;
  dashboardAccentColor: string;
  leadGrabEnabled: boolean;
};

const SALES_LEAD_SETTINGS_DIR = path.join(process.cwd(), ".gigxomi");
const SALES_LEAD_SETTINGS_FILE = path.join(SALES_LEAD_SETTINGS_DIR, "sales-lead-settings.json");

export interface SalesLeadConfig {
  leadGrabEnabled: boolean;
  autoAssignAgentId: string;
  autoAssignAgentName: string;
}

const DEFAULT_SALES_LEAD_CONFIG: SalesLeadConfig = {
  leadGrabEnabled: false,
  autoAssignAgentId: "cms1gc6tk0000tqjplhlhcvys", // Anshita Gaur (GX-ANSHITA-20E6AE)
  autoAssignAgentName: "Anshita Gaur",
};

let salesLeadConfigCache: SalesLeadConfig | null = null;

export async function getSalesLeadConfig(): Promise<SalesLeadConfig> {
  if (salesLeadConfigCache) return salesLeadConfigCache;
  try {
    const raw = await readFile(SALES_LEAD_SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const config: SalesLeadConfig = { ...DEFAULT_SALES_LEAD_CONFIG, ...parsed };
    salesLeadConfigCache = config;
    return config;
  } catch {
    const config: SalesLeadConfig = { ...DEFAULT_SALES_LEAD_CONFIG };
    salesLeadConfigCache = config;
    return config;
  }
}

export async function updateSalesLeadConfig(patch: Partial<SalesLeadConfig>): Promise<SalesLeadConfig> {
  const current = await getSalesLeadConfig();
  const next = { ...current, ...patch };
  salesLeadConfigCache = next;
  try {
    await mkdir(SALES_LEAD_SETTINGS_DIR, { recursive: true });
    await writeFile(SALES_LEAD_SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  } catch (err) {
    console.error("[sales-store] Failed to persist sales lead config:", err);
  }
  return next;
}

type SalesPackagePayload = Prisma.PackageGetPayload<{
  include: {
    featureValues: {
      include: {
        feature: true;
      };
    };
  };
}>;

type SalesAgentView = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  phone: string;
  groupId: string | null;
  parentAgentId: string | null;
  agentCode: string;
  status: SalesAgentStatus;
  commissionPercent: number | null;
  payoutInfo: Record<string, unknown> | null;
  canCreateSubAgents: boolean;
  canClaimLeads: boolean;
  maxActiveLeads: number | null;
  permissions: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type SalesLeadPoolView = {
  id: string;
  assignedAgentId: string | null;
  claimedByAgentId: string | null;
  convertedAssignmentId: string | null;
  conversationId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  source: string;
  serviceInterest: string;
  segment: string;
  priority: string;
  budgetAmount: number;
  status: SalesLeadPoolStatus;
  notes: string;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SalesLeadView = {
  id: string;
  leadId: string | null;
  assignedAgentId: string;
  createdById: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  source: string;
  serviceInterest: string;
  segment: string;
  priority: string;
  tags: string[];
  conversationId: string | null;
  budgetAmount: number;
  stage: SalesLeadStage;
  followUpAt: string | null;
  lastContactedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type SalesDealView = {
  id: string;
  assignmentId: string;
  agentId: string;
  packageId: string | null;
  packageName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  quoteId: string | null;
  paymentTransactionId: string | null;
  referralCodeId: string | null;
  title: string;
  agreedAmount: number;
  paidAmount: number;
  status: SalesDealStatus;
  paymentReference: string | null;
  handoffNotes: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SalesEarningView = {
  id: string;
  dealId: string;
  agentId: string;
  ruleId: string | null;
  amount: number;
  parentAmount: number;
  status: SalesEarningStatus;
  payoutId: string | null;
  createdAt: string;
  updatedAt: string;
};

type SalesPayoutView = {
  id: string;
  agentId: string;
  amount: number;
  status: SalesPayoutStatus;
  note: string;
  requestedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  updatedAt: string;
};

type SalesReferralEventView = {
  id: string;
  referralCodeId: string;
  agentId: string;
  userId: string | null;
  packageId: string | null;
  paymentTransactionId: string | null;
  dealId: string | null;
  eventType: SalesReferralEventType;
  path: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type SalesGoalView = {
  id: string;
  name: string;
  metric: SalesGoalMetric;
  scope: SalesGoalScope;
  agentId: string | null;
  groupId: string | null;
  target: number;
  currentValue: number;
  progressPercent: number;
  rewardText: string;
  startsAt: string | null;
  endsAt: string | null;
  isPinned: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type SalesRewardView = {
  id: string;
  title: string;
  body: string;
  agentId: string | null;
  groupId: string | null;
  isPinned: boolean;
  isActive: boolean;
  unlockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SalesDashboardSnapshot = {
  settings: SalesModuleSettings;
  groups: Array<{
    id: string;
    name: string;
    description: string;
    defaultCommissionPercent: number;
    parentCommissionPercent: number;
    maxDiscountPercent: number | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  agents: SalesAgentView[];
  currentAgent: SalesAgentView | null;
  visibleAgents: SalesAgentView[];
  visibleLeadPool: SalesLeadPoolView[];
  visibleLeads: SalesLeadView[];
  visibleDeals: SalesDealView[];
  visibleEarnings: SalesEarningView[];
  visiblePayouts: SalesPayoutView[];
  leadPool: SalesLeadPoolView[];
  leads: SalesLeadView[];
  deals: SalesDealView[];
  commissionRules: Array<{
    id: string;
    name: string;
    type: SalesCommissionRuleType;
    scope: SalesCommissionScope;
    appliesTo: SalesCommissionAppliesTo;
    groupId: string | null;
    agentId: string | null;
    packageId: string | null;
    serviceId: string | null;
    value: number;
    parentCommissionPercent: number | null;
    minOrderValue: number | null;
    maxOrderValue: number | null;
    priority: number;
    isActive: boolean;
  }>;
  earnings: SalesEarningView[];
  payouts: SalesPayoutView[];
  referrals: Array<{
    id: string;
    agentId: string;
    code: string;
    label: string;
    isActive: boolean;
    registrationUrl: string;
    pricingUrl: string;
    createdAt: string;
    updatedAt: string;
  }>;
  referralEvents: SalesReferralEventView[];
  announcements: Array<{ id: string; title: string; body: string; audience: string; isActive: boolean; createdAt: string; updatedAt: string }>;
  messages: Array<{ id: string; agentId: string | null; subject: string; status: string; messages: Array<{ author: string; body: string; createdAt: string }>; createdAt: string; updatedAt: string }>;
  packages: Array<{
    id: string;
    name: string;
    slug: string;
    shortSubtitle: string;
    description: string;
    badgeText: string;
    amount: number;
    currency: string;
    priceLabel: string;
    billingLabel: string;
    audience: string;
    featureBullets: string[];
    compareHighlights: string[];
    isActive: boolean;
    isRecommended: boolean;
  }>;
  goals: SalesGoalView[];
  rewards: SalesRewardView[];
  mobileDevices: Array<{ id: string; agentId: string; deviceId: string; deviceName: string; manufacturer: string; model: string; simLabel: string; officeSimNumber: string; recordingCapability: string; recordingEnabled: boolean; lastSeenAt: string; isActive: boolean }>;
  mobileCalls: Array<{ id: string; assignmentId: string; agentId: string; customerName: string; phoneNumber: string; deviceName: string; deviceModel: string; status: string; outcome: string; note: string; durationSeconds: number; recordingStatus: string; recordingError: string; noteSubmitted: boolean; startedAt: string; endedAt: string | null }>;
  reports: {
    assignedLeads: number;
    openQueueLeads: number;
    claimedLeads: number;
    closedDeals: number;
    paidRevenue: number;
    pendingRevenue: number;
    conversionRate: number;
    approvedEarnings: number;
    availableBalance: number;
    pendingPayout: number;
    walletBreakdown: {
      inNegotiation: number;
      pendingValidation: number;
      pendingVesting: number;
      availableForPayout: number;
    };
    referralViews: number;
    referralSignups: number;
    referralPayments: number;
    leaderboard: Array<{ agentId: string; name: string; paidRevenue: number; closedDeals: number; approvedEarnings: number; claimedLeads: number; conversionRate: number; score: number }>;
    earningsSeries: Array<{ label: string; amount: number }>;
    funnel: Array<{ stage: SalesLeadStage; count: number; value: number }>;
  };
};

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function readJsonObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readJsonMessages(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      return {
        author: String(record.author ?? "System"),
        body: String(record.body ?? ""),
        createdAt: String(record.createdAt ?? new Date().toISOString()),
      };
    })
    .filter((item): item is { author: string; body: string; createdAt: string } => Boolean(item?.body));
}

async function ensureSalesDefaults() {
  const [settings, group] = await Promise.all([
    prisma.salesSettings.upsert({
      where: { id: "sales-settings" },
      update: {},
      create: { id: "sales-settings" },
    }),
    prisma.salesAgentGroup.upsert({
      where: { id: "sales-group-main" },
      update: {},
      create: {
        id: "sales-group-main",
        name: "Gigxomi Closers",
        description: "Default commission tier for remote sales agents.",
        defaultCommissionPercent: 10,
        parentCommissionPercent: 2,
        maxDiscountPercent: 0,
      },
    }),
  ]);

  await prisma.salesCommissionRule.upsert({
    where: { id: "sales-rule-default-paid-package" },
    update: {},
    create: {
      id: "sales-rule-default-paid-package",
      name: "Default paid package commission",
      type: "PERCENTAGE",
      scope: "ALL_AGENTS",
      appliesTo: "ALL_PACKAGES",
      value: settings.defaultCommissionPercent,
      parentCommissionPercent: group.parentCommissionPercent,
      priority: 1,
      isActive: true,
    },
  });

  await prisma.salesGoal.upsert({
    where: { id: "sales-goal-monthly-revenue" },
    update: {},
    create: {
      id: "sales-goal-monthly-revenue",
      name: "Monthly revenue sprint",
      metric: "PAID_REVENUE",
      scope: "ALL_AGENTS",
      target: 100000,
      rewardText: "Top closer gets the pinned Gigxomi revenue bonus review.",
      isPinned: true,
      isActive: true,
    },
  });

  await prisma.salesReward.upsert({
    where: { id: "sales-reward-response-streak" },
    update: {},
    create: {
      id: "sales-reward-response-streak",
      title: "Fast follow-up streak",
      body: "Keep new leads moving within the same day to protect conversion and payout velocity.",
      isPinned: true,
      isActive: true,
    },
  });

  if (process.env.NODE_ENV !== "production") {
    const poolCount = await prisma.salesLeadPoolItem.count();
    if (poolCount === 0) {
      await prisma.salesLeadPoolItem.createMany({
        data: [
          {
            id: "sales-pool-sample-creator-reels",
            customerName: "Aarav Mehta",
            customerPhone: "+919876543210",
            customerEmail: "aarav@example.com",
            source: "pricing",
            serviceInterest: "Creator reels monthly package",
            segment: "creator",
            priority: "hot",
            budgetAmount: 18000,
            notes: "Asked for 12 short-form edits and a weekly delivery rhythm.",
          },
          {
            id: "sales-pool-sample-wedding-film",
            customerName: "Riya Sharma",
            customerPhone: "+919812341111",
            customerEmail: "riya@example.com",
            source: "whatsapp",
            serviceInterest: "Wedding teaser and reels package",
            segment: "wedding",
            priority: "warm",
            budgetAmount: 5800,
            notes: "Needs sample work and payment link after quote confirmation.",
          },
          {
            id: "sales-pool-sample-agency-overflow",
            customerName: "PixelForge Studio",
            customerPhone: "+919900001234",
            customerEmail: "ops@pixelforge.example",
            source: "agency-growth",
            serviceInterest: "Agency overflow editing capacity",
            segment: "agency",
            priority: "hot",
            budgetAmount: 45000,
            notes: "Looking for reliable editing capacity for YouTube and ad creatives.",
          },
          {
            id: "sales-pool-sample-youtube-channel",
            customerName: "Neha Kapoor",
            customerPhone: "+919700004321",
            customerEmail: "neha@example.com",
            source: "referral",
            serviceInterest: "YouTube long-form editor",
            segment: "youtube",
            priority: "normal",
            budgetAmount: 12000,
            notes: "Compare monthly freelancer packages before call.",
          },
        ],
        skipDuplicates: true,
      });
    }
  }

  return settings;
}

function mapSettings(settings: Awaited<ReturnType<typeof ensureSalesDefaults>>, leadConfig?: SalesLeadConfig) {
  return {
    moduleEnabled: settings.moduleEnabled,
    signupRequiresApproval: settings.signupRequiresApproval,
    defaultCommissionPercent: toNumber(settings.defaultCommissionPercent),
    payoutMinimum: toNumber(settings.payoutMinimum),
    enableAnnouncements: settings.enableAnnouncements,
    enableMessages: settings.enableMessages,
    enableReferralLinks: settings.enableReferralLinks,
    enableTeams: settings.enableTeams,
    enableEarnings: settings.enableEarnings,
    enablePayouts: settings.enablePayouts,
    enablePackageLinks: settings.enablePackageLinks,
    dashboardPrimaryColor: settings.dashboardPrimaryColor,
    dashboardAccentColor: settings.dashboardAccentColor,
    leadGrabEnabled: leadConfig?.leadGrabEnabled ?? false,
  };
}

function mapAgent(agent: Prisma.SalesAgentProfileGetPayload<{ include: { user: true } }>): SalesAgentView {
  return {
    id: agent.id,
    userId: agent.userId,
    displayName: agent.user.displayName,
    email: agent.user.email ?? "",
    phone: agent.user.phone,
    groupId: agent.groupId,
    parentAgentId: agent.parentAgentId,
    agentCode: agent.agentCode,
    status: agent.status as SalesAgentStatus,
    commissionPercent: agent.commissionPercent === null ? null : toNumber(agent.commissionPercent),
    payoutInfo: readJsonObject(agent.payoutInfo),
    canCreateSubAgents: agent.canCreateSubAgents,
    canClaimLeads: agent.canClaimLeads,
    maxActiveLeads: agent.maxActiveLeads,
    permissions: readJsonObject(agent.permissions),
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

function mapLeadPoolItem(item: Prisma.SalesLeadPoolItemGetPayload<object>): SalesLeadPoolView {
  return {
    id: item.id,
    assignedAgentId: item.assignedAgentId,
    claimedByAgentId: item.claimedByAgentId,
    convertedAssignmentId: item.convertedAssignmentId,
    conversationId: item.conversationId,
    customerName: item.customerName,
    customerPhone: item.customerPhone ?? "",
    customerEmail: item.customerEmail ?? "",
    source: item.source,
    serviceInterest: item.serviceInterest ?? "",
    segment: item.segment ?? "",
    priority: item.priority,
    budgetAmount: toNumber(item.budgetAmount),
    status: item.status as SalesLeadPoolStatus,
    notes: item.notes ?? "",
    claimedAt: iso(item.claimedAt),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function maskContact(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) {
    const [name, domain] = trimmed.split("@");
    return `${name.slice(0, 2)}***@${domain ?? "hidden"}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, 2)}****${digits.slice(-2)}`;
}

function maskOpenPoolItem(item: SalesLeadPoolView) {
  return {
    ...item,
    customerPhone: maskContact(item.customerPhone),
    customerEmail: maskContact(item.customerEmail),
    notes: item.notes ? "Claim this lead to unlock full notes." : "",
  };
}

function mapLead(lead: Prisma.SalesLeadAssignmentGetPayload<object>): SalesLeadView {
  return {
    id: lead.id,
    leadId: lead.leadId,
    assignedAgentId: lead.assignedAgentId,
    createdById: lead.createdById,
    customerName: lead.customerName,
    customerPhone: lead.customerPhone ?? "",
    customerEmail: lead.customerEmail ?? "",
    source: lead.source,
    serviceInterest: lead.serviceInterest ?? "",
    segment: lead.segment ?? "",
    priority: lead.priority,
    tags: lead.tags,
    conversationId: lead.conversationId,
    budgetAmount: toNumber(lead.budgetAmount),
    stage: lead.stage as SalesLeadStage,
    followUpAt: iso(lead.followUpAt),
    lastContactedAt: iso(lead.lastContactedAt),
    notes: lead.notes ?? "",
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

function mapDeal(deal: Prisma.SalesDealGetPayload<{ include: { package: true; service: true } }>): SalesDealView {
  return {
    id: deal.id,
    assignmentId: deal.assignmentId,
    agentId: deal.agentId,
    packageId: deal.packageId,
    packageName: deal.package?.name ?? null,
    serviceId: deal.serviceId,
    serviceName: deal.service?.title ?? null,
    quoteId: deal.quoteId,
    paymentTransactionId: deal.paymentTransactionId,
    referralCodeId: deal.referralCodeId,
    title: deal.title,
    agreedAmount: toNumber(deal.agreedAmount),
    paidAmount: toNumber(deal.paidAmount),
    status: deal.status as SalesDealStatus,
    paymentReference: deal.paymentReference,
    handoffNotes: deal.handoffNotes ?? "",
    closedAt: iso(deal.closedAt),
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
  };
}

function mapEarning(earning: Prisma.SalesEarningGetPayload<object>): SalesEarningView {
  return {
    id: earning.id,
    dealId: earning.dealId,
    agentId: earning.agentId,
    ruleId: earning.ruleId,
    amount: toNumber(earning.amount),
    parentAmount: toNumber(earning.parentAmount),
    status: earning.status as SalesEarningStatus,
    payoutId: earning.payoutId,
    createdAt: earning.createdAt.toISOString(),
    updatedAt: earning.updatedAt.toISOString(),
  };
}

function mapPayout(payout: Prisma.SalesPayoutGetPayload<object>): SalesPayoutView {
  return {
    id: payout.id,
    agentId: payout.agentId,
    amount: toNumber(payout.amount),
    status: payout.status as SalesPayoutStatus,
    note: payout.note ?? "",
    requestedAt: payout.requestedAt.toISOString(),
    approvedAt: iso(payout.approvedAt),
    paidAt: iso(payout.paidAt),
    updatedAt: payout.updatedAt.toISOString(),
  };
}

function formatPackageMoney(currency: string, amount: number) {
  if (currency.toUpperCase() === "INR") {
    return `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount)}`;
  }
  return `${currency.toUpperCase()} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount)}`;
}

function packageBillingLabel(type: string, interval: string) {
  if (type === "FREE") return "Get started";
  if (type === "ONE_TIME_PAID" || interval === "ONE_TIME") return "One-time payment";
  if (interval === "MONTHLY") return "Per month";
  if (interval === "QUARTERLY") return "Per quarter";
  if (interval === "YEARLY") return "Per year";
  return "Custom billing";
}

function mapSalesPackage(pkg: SalesPackagePayload) {
  const amount = toNumber(pkg.amount);
  const featureBullets = pkg.selectedSummaryBullets.length
    ? pkg.selectedSummaryBullets
    : pkg.featureValues
        .filter((item) => item.feature.showInSelectedSummary)
        .sort((left, right) => left.feature.sortOrder - right.feature.sortOrder)
        .map((item) => item.shortDisplayText ?? item.feature.shortDisplayText ?? item.feature.featureLabel);
  const compareHighlights = pkg.compareHighlights.length
    ? pkg.compareHighlights
    : pkg.featureValues
        .filter((item) => item.feature.showInRegistrationCompare)
        .sort((left, right) => left.feature.sortOrder - right.feature.sortOrder)
        .map((item) => item.shortDisplayText ?? item.feature.shortDisplayText ?? item.feature.featureLabel);

  return {
    id: pkg.id,
    name: pkg.name,
    slug: pkg.slug,
    shortSubtitle: pkg.shortSubtitle ?? "",
    description: pkg.description ?? "",
    badgeText: pkg.badgeText ?? "",
    amount,
    currency: pkg.currency,
    priceLabel: formatPackageMoney(pkg.currency, amount),
    billingLabel: packageBillingLabel(pkg.billingType, pkg.billingInterval),
    audience: pkg.packageType,
    featureBullets,
    compareHighlights,
    isActive: pkg.isActive,
    isRecommended: pkg.isRecommended,
  };
}

function mapReferralEvent(event: Prisma.SalesReferralEventGetPayload<object>): SalesReferralEventView {
  return {
    id: event.id,
    referralCodeId: event.referralCodeId,
    agentId: event.agentId,
    userId: event.userId,
    packageId: event.packageId,
    paymentTransactionId: event.paymentTransactionId,
    dealId: event.dealId,
    eventType: event.eventType as SalesReferralEventType,
    path: event.path ?? "",
    metadata: readJsonObject(event.metadata),
    createdAt: event.createdAt.toISOString(),
  };
}

function metricValueForGoal(input: {
  goal: Prisma.SalesGoalGetPayload<object>;
  agents: SalesAgentView[];
  leadPool: SalesLeadPoolView[];
  leads: SalesLeadView[];
  deals: SalesDealView[];
  referralEvents: SalesReferralEventView[];
}) {
  const scopedAgents = input.agents.filter((agent) => {
    if (input.goal.scope === "INDIVIDUAL_AGENT") return agent.id === input.goal.agentId;
    if (input.goal.scope === "AGENT_GROUP") return agent.groupId === input.goal.groupId;
    return true;
  });
  const scopedAgentIds = new Set(scopedAgents.map((agent) => agent.id));
  const scopedLeads = input.leads.filter((lead) => scopedAgentIds.has(lead.assignedAgentId));
  const paidDeals = input.deals.filter((deal) => scopedAgentIds.has(deal.agentId) && ["PAID", "HANDOFF", "CLOSED"].includes(deal.status));
  if (input.goal.metric === "PAID_REVENUE") {
    return paidDeals.reduce((sum, deal) => sum + deal.paidAmount, 0);
  }
  if (input.goal.metric === "CLOSED_DEALS") {
    return paidDeals.length;
  }
  if (input.goal.metric === "REFERRAL_SIGNUPS") {
    return input.referralEvents.filter((event) => scopedAgentIds.has(event.agentId) && (event.eventType === "SIGNUP_STARTED" || event.eventType === "SIGNUP_VERIFIED")).length;
  }
  if (input.goal.metric === "CONVERSION_RATE") {
    return scopedLeads.length ? Math.round((paidDeals.length / scopedLeads.length) * 100) : 0;
  }
  return input.leadPool.filter((item) => item.claimedByAgentId && scopedAgentIds.has(item.claimedByAgentId)).length;
}

function mapGoal(
  goal: Prisma.SalesGoalGetPayload<object>,
  context: {
    agents: SalesAgentView[];
    leadPool: SalesLeadPoolView[];
    leads: SalesLeadView[];
    deals: SalesDealView[];
    referralEvents: SalesReferralEventView[];
  },
): SalesGoalView {
  const target = Math.max(toNumber(goal.target), 1);
  const currentValue = metricValueForGoal({ goal, ...context });
  return {
    id: goal.id,
    name: goal.name,
    metric: goal.metric as SalesGoalMetric,
    scope: goal.scope as SalesGoalScope,
    agentId: goal.agentId,
    groupId: goal.groupId,
    target,
    currentValue,
    progressPercent: Math.min(100, Math.round((currentValue / target) * 100)),
    rewardText: goal.rewardText ?? "",
    startsAt: iso(goal.startsAt),
    endsAt: iso(goal.endsAt),
    isPinned: goal.isPinned,
    isActive: goal.isActive,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

function mapReward(reward: Prisma.SalesRewardGetPayload<object>): SalesRewardView {
  return {
    id: reward.id,
    title: reward.title,
    body: reward.body,
    agentId: reward.agentId,
    groupId: reward.groupId,
    isPinned: reward.isPinned,
    isActive: reward.isActive,
    unlockedAt: iso(reward.unlockedAt),
    createdAt: reward.createdAt.toISOString(),
    updatedAt: reward.updatedAt.toISOString(),
  };
}

function buildReferralUrls(code: string) {
  const ref = encodeURIComponent(code);
  return {
    registrationUrl: buildSiteUrl(`/signup?ref=${ref}`),
    pricingUrl: buildSiteUrl(`/pricing?ref=${ref}`),
  };
}

function buildReports(input: {
  agents: SalesAgentView[];
  leadPool: SalesLeadPoolView[];
  leads: SalesLeadView[];
  deals: SalesDealView[];
  earnings: SalesEarningView[];
  payouts: SalesPayoutView[];
  referralEvents: SalesReferralEventView[];
}) {
  const visibleAgentIds = new Set(input.agents.map((agent) => agent.id));
  const paidDeals = input.deals.filter((deal) => ["PAID", "HANDOFF", "CLOSED"].includes(deal.status));
  const paidRevenue = paidDeals.reduce((sum, deal) => sum + deal.paidAmount, 0);
  const pendingRevenue = input.deals.filter((deal) => deal.status === "PAYMENT_PENDING").reduce((sum, deal) => sum + deal.agreedAmount, 0);
  const now = Date.now();
  const sevenDayMs = 7 * 24 * 60 * 60 * 1000;
  const approvedEarnings = input.earnings.filter((earning) => earning.status === "APPROVED" || earning.status === "PAID").reduce((sum, earning) => sum + earning.amount, 0);
  const inNegotiation = input.leads.filter((lead) => ["CONTACTED", "QUALIFIED", "QUOTE_SENT"].includes(lead.stage)).reduce((sum, lead) => sum + lead.budgetAmount, 0);
  const pendingValidation = input.earnings.filter((earning) => earning.status === "PENDING").reduce((sum, earning) => sum + earning.amount, 0);
  const pendingVesting = input.earnings
    .filter((earning) => earning.status === "APPROVED" && !earning.payoutId && now - new Date(earning.createdAt).getTime() < sevenDayMs)
    .reduce((sum, earning) => sum + earning.amount, 0);
  const availableBalance = input.earnings
    .filter((earning) => earning.status === "APPROVED" && !earning.payoutId && now - new Date(earning.createdAt).getTime() >= sevenDayMs)
    .reduce((sum, earning) => sum + earning.amount, 0);
  const pendingPayout = input.payouts.filter((payout) => payout.status === "REQUESTED" || payout.status === "APPROVED").reduce((sum, payout) => sum + payout.amount, 0);
  const openQueueLeads = input.leadPool.filter((item) => item.status === "OPEN").length;
  const claimedLeads = input.leadPool.filter((item) => item.status === "CLAIMED").length;
  const referralViews = input.referralEvents.filter((event) => event.eventType === "PRICING_VIEW").length;
  const referralSignups = input.referralEvents.filter((event) => event.eventType === "SIGNUP_STARTED" || event.eventType === "SIGNUP_VERIFIED").length;
  const referralPayments = input.referralEvents.filter((event) => event.eventType === "PAYMENT_SUCCESS" || event.eventType === "DEAL_CREATED").length;
  const earningsByMonth = new Map<string, number>();
  for (const earning of input.earnings.filter((item) => item.status === "APPROVED" || item.status === "PAID")) {
    const date = new Date(earning.createdAt);
    const label = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-IN", { month: "short" }).format(date) : "Now";
    earningsByMonth.set(label, (earningsByMonth.get(label) ?? 0) + earning.amount);
  }
  const funnel = (["NEW", "CONTACTED", "QUALIFIED", "QUOTE_SENT", "PAYMENT_PENDING", "PAID", "HANDOFF", "CONVERTED_FREE", "CLOSED", "LOST"] as SalesLeadStage[]).map((stage) => {
    const stageLeads = input.leads.filter((lead) => lead.stage === stage);
    return {
      stage,
      count: stageLeads.length,
      value: stageLeads.reduce((sum, lead) => sum + lead.budgetAmount, 0),
    };
  });

  return {
    assignedLeads: input.leads.length,
    openQueueLeads,
    claimedLeads,
    closedDeals: paidDeals.length,
    paidRevenue,
    pendingRevenue,
    conversionRate: input.leads.length ? Math.round((paidDeals.length / input.leads.length) * 100) : 0,
    approvedEarnings,
    availableBalance,
    pendingPayout,
    walletBreakdown: {
      inNegotiation,
      pendingValidation,
      pendingVesting,
      availableForPayout: availableBalance,
    },
    referralViews,
    referralSignups,
    referralPayments,
    leaderboard: input.agents
      .map((agent) => {
        const agentDeals = input.deals.filter((deal) => deal.agentId === agent.id && ["PAID", "HANDOFF", "CLOSED"].includes(deal.status));
        const agentLeads = input.leads.filter((lead) => lead.assignedAgentId === agent.id);
        const agentClaimedLeads = input.leadPool.filter((item) => item.claimedByAgentId === agent.id).length;
        const agentPaidRevenue = agentDeals.reduce((sum, deal) => sum + deal.paidAmount, 0);
        const agentApprovedEarnings = input.earnings
          .filter((earning) => earning.agentId === agent.id && (earning.status === "APPROVED" || earning.status === "PAID"))
          .reduce((sum, earning) => sum + earning.amount, 0);
        const agentConversionRate = agentLeads.length ? Math.round((agentDeals.length / agentLeads.length) * 100) : 0;
        return {
          agentId: agent.id,
          name: agent.displayName,
          paidRevenue: agentPaidRevenue,
          closedDeals: agentDeals.length,
          approvedEarnings: agentApprovedEarnings,
          claimedLeads: agentClaimedLeads,
          conversionRate: agentConversionRate,
          score: Math.round(agentPaidRevenue / 100 + agentDeals.length * 120 + agentApprovedEarnings / 40 + agentConversionRate * 5 + agentClaimedLeads * 25),
        };
      })
      .filter((row) => visibleAgentIds.has(row.agentId))
      .sort((left, right) => right.score - left.score),
    earningsSeries: Array.from(earningsByMonth.entries()).slice(-6).map(([seriesLabel, amount]) => ({ label: seriesLabel, amount })),
    funnel,
  };
}

type SalesAgentWriteClient = Pick<Prisma.TransactionClient, "appAuthUser" | "salesAgentGroup" | "salesAgentProfile" | "salesReferralCode">;

async function generateAgentCode(displayName: string, database: SalesAgentWriteClient = prisma) {
  const prefix = normalizeCode(`GX-${displayName.split(/\s+/)[0] || "AGENT"}`) || "GX-AGENT";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = normalizeCode(`${prefix}-${randomBytes(3).toString("hex")}`);
    const existing = await database.salesReferralCode.findUnique({ where: { code } });
    if (!existing) return code;
  }
  return normalizeCode(`${prefix}-${Date.now().toString(36)}`);
}

export async function getSalesAgentAccess(userId: string | null | undefined) {
  if (!userId) return { ok: false as const, reason: "missing" as const, agent: null };
  await ensureSalesDefaults();
  const agent = await prisma.salesAgentProfile.findUnique({ where: { userId }, include: { user: true } });
  if (!agent) return { ok: false as const, reason: "missing" as const, agent: null };
  if (agent.status !== "ACTIVE") return { ok: false as const, reason: agent.status as "PENDING" | "SUSPENDED", agent: mapAgent(agent) };
  return { ok: true as const, reason: "ACTIVE" as const, agent: mapAgent(agent) };
}

export async function findActiveReferralCode(rawCode: string | null | undefined) {
  const code = normalizeCode(rawCode ?? "");
  if (!code) return null;
  return prisma.salesReferralCode.findFirst({
    where: { code, isActive: true, agent: { status: "ACTIVE" } },
    include: { agent: { include: { user: true, group: true } } },
  });
}

export async function trackSalesReferralEvent(input: {
  code?: string | null;
  eventType: SalesReferralEventType;
  path?: string | null;
  packageId?: string | null;
  userId?: string | null;
  paymentTransactionId?: string | null;
  dealId?: string | null;
  eventKey?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await ensureSalesDefaults();
  const referral = await findActiveReferralCode(input.code);
  if (!referral) {
    return { ok: true as const, skipped: true as const };
  }
  const eventKey =
    input.eventKey?.trim() ||
    (input.eventType === "PRICING_VIEW"
      ? ""
      : [
          referral.id,
          input.eventType,
          input.userId ?? "",
          input.packageId ?? "",
          input.paymentTransactionId ?? "",
          input.dealId ?? "",
          input.path ?? "",
        ]
          .filter(Boolean)
          .join(":"));
  const createData = {
    referralCodeId: referral.id,
    agentId: referral.agentId,
    userId: input.userId?.trim() || null,
    packageId: input.packageId?.trim() || null,
    paymentTransactionId: input.paymentTransactionId?.trim() || null,
    dealId: input.dealId?.trim() || null,
    eventType: input.eventType,
    eventKey: eventKey || null,
    path: input.path?.trim() || null,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonObject,
  };
  const event = eventKey
    ? await prisma.salesReferralEvent.upsert({
        where: { eventKey },
        update: {
          path: input.path?.trim() || undefined,
          metadata: input.metadata as Prisma.InputJsonObject | undefined,
        },
        create: createData,
      })
    : await prisma.salesReferralEvent.create({
        data: createData,
      });
  return { ok: true as const, event: mapReferralEvent(event) };
}

export async function getSalesSnapshotForRole(session: { userId?: string | null; role: AppRole | "GUEST" }) {
  const [settings, leadConfig] = await Promise.all([ensureSalesDefaults(), getSalesLeadConfig()]);
  const [groups, agentsRaw, leadPoolRaw, leadsRaw, dealsRaw, rulesRaw, earningsRaw, payoutsRaw, referralsRaw, referralEventsRaw, announcementsRaw, messagesRaw, packagesRaw, goalsRaw, rewardsRaw, mobileDevicesRaw, mobileCallsRaw] = await Promise.all([
    prisma.salesAgentGroup.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.salesAgentProfile.findMany({ include: { user: true }, orderBy: { createdAt: "desc" } }),
    prisma.salesLeadPoolItem.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    prisma.salesLeadAssignment.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.salesDeal.findMany({ include: { package: true, service: true }, orderBy: { updatedAt: "desc" } }),
    prisma.salesCommissionRule.findMany({ orderBy: [{ priority: "desc" }, { updatedAt: "desc" }] }),
    prisma.salesEarning.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.salesPayout.findMany({ orderBy: { requestedAt: "desc" } }),
    prisma.salesReferralCode.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.salesReferralEvent.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.salesAnnouncement.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" } }),
    prisma.salesMessageThread.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.package.findMany({ where: { isActive: true }, include: { featureValues: { include: { feature: true } } }, orderBy: { sortOrder: "asc" } }),
    prisma.salesGoal.findMany({ where: { isActive: true }, orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }] }),
    prisma.salesReward.findMany({ where: { isActive: true }, orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }] }),
    prisma.salesMobileDevice.findMany({ orderBy: { lastSeenAt: "desc" } }),
    prisma.salesMobileCall.findMany({ include: { assignment: true, device: true }, orderBy: { startedAt: "desc" }, take: 250 }),
  ]);

  const agents = agentsRaw.map(mapAgent);
  const currentAgent = agents.find((agent) => agent.userId === session.userId) ?? null;
  const visibleAgents =
    session.role === "SUPER_ADMIN"
      ? agents
      : currentAgent
        ? agents.filter((agent) => agent.id === currentAgent.id || agent.parentAgentId === currentAgent.id)
        : [];
  const visibleAgentIds = new Set(visibleAgents.map((agent) => agent.id));
  const leadPool = leadPoolRaw.map(mapLeadPoolItem);
  const leads = leadsRaw.map(mapLead);
  const deals = dealsRaw.map(mapDeal);
  const earnings = earningsRaw.map(mapEarning);
  const payouts = payoutsRaw.map(mapPayout);
  const referralEvents = referralEventsRaw.map(mapReferralEvent);
  const visibleLeadPool =
    session.role === "SUPER_ADMIN"
      ? leadPool
      : currentAgent
        ? leadPool
            .filter(
              (item) =>
                (item.status === "OPEN" && (!item.assignedAgentId || item.assignedAgentId === currentAgent.id)) ||
                item.claimedByAgentId === currentAgent.id ||
                Boolean(item.claimedByAgentId && visibleAgentIds.has(item.claimedByAgentId)),
            )
            .map((item) => (item.status === "OPEN" && item.claimedByAgentId !== currentAgent.id ? maskOpenPoolItem(item) : item))
        : [];
  const visibleLeads = leads.filter((lead) => visibleAgentIds.has(lead.assignedAgentId));
  const visibleDeals = deals.filter((deal) => visibleAgentIds.has(deal.agentId));
  const visibleEarnings = earnings.filter((earning) => visibleAgentIds.has(earning.agentId));
  const visiblePayouts = payouts.filter((payout) => visibleAgentIds.has(payout.agentId));
  const visibleReferralEvents = referralEvents.filter((event) => visibleAgentIds.has(event.agentId));
  const visibleGoals = goalsRaw
    .filter((goal) => {
      if (session.role === "SUPER_ADMIN") return true;
      if (!currentAgent) return false;
      if (goal.scope === "ALL_AGENTS") return true;
      if (goal.scope === "AGENT_GROUP") return goal.groupId === currentAgent.groupId;
      return goal.agentId === currentAgent.id || Boolean(goal.agentId && visibleAgentIds.has(goal.agentId));
    })
    .map((goal) => mapGoal(goal, { agents: visibleAgents, leadPool: visibleLeadPool, leads: visibleLeads, deals: visibleDeals, referralEvents: visibleReferralEvents }));
  const visibleRewards = rewardsRaw
    .filter((reward) => {
      if (session.role === "SUPER_ADMIN") return true;
      if (!currentAgent) return false;
      if (!reward.agentId && !reward.groupId) return true;
      if (reward.groupId) return reward.groupId === currentAgent.groupId;
      return reward.agentId === currentAgent.id || Boolean(reward.agentId && visibleAgentIds.has(reward.agentId));
    })
    .map(mapReward);

  return {
    settings: mapSettings(settings, leadConfig),
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description ?? "",
      defaultCommissionPercent: toNumber(group.defaultCommissionPercent),
      parentCommissionPercent: toNumber(group.parentCommissionPercent),
      maxDiscountPercent: group.maxDiscountPercent === null ? null : toNumber(group.maxDiscountPercent),
      isActive: group.isActive,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    })),
    agents,
    currentAgent,
    visibleAgents,
    visibleLeadPool,
    visibleLeads,
    visibleDeals,
    visibleEarnings,
    visiblePayouts,
    leadPool,
    leads,
    deals,
    commissionRules: rulesRaw.map((rule) => ({
      id: rule.id,
      name: rule.name,
      type: rule.type as SalesCommissionRuleType,
      scope: rule.scope as SalesCommissionScope,
      appliesTo: rule.appliesTo as SalesCommissionAppliesTo,
      groupId: rule.groupId,
      agentId: rule.agentId,
      packageId: rule.packageId,
      serviceId: rule.serviceId,
      value: toNumber(rule.value),
      parentCommissionPercent: rule.parentCommissionPercent === null ? null : toNumber(rule.parentCommissionPercent),
      minOrderValue: rule.minOrderValue === null ? null : toNumber(rule.minOrderValue),
      maxOrderValue: rule.maxOrderValue === null ? null : toNumber(rule.maxOrderValue),
      priority: rule.priority,
      isActive: rule.isActive,
    })),
    earnings,
    payouts,
    referrals: referralsRaw.map((referral) => ({
      id: referral.id,
      agentId: referral.agentId,
      code: referral.code,
      label: referral.label ?? "Default referral link",
      isActive: referral.isActive,
      ...buildReferralUrls(referral.code),
      createdAt: referral.createdAt.toISOString(),
      updatedAt: referral.updatedAt.toISOString(),
    })),
    referralEvents: visibleReferralEvents,
    announcements: announcementsRaw.map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      audience: announcement.audience,
      isActive: announcement.isActive,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
    })),
    messages: messagesRaw.map((thread) => ({
      id: thread.id,
      agentId: thread.agentId,
      subject: thread.subject,
      status: thread.status,
      messages: readJsonMessages(thread.messages),
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    })),
    packages: packagesRaw.map(mapSalesPackage),
    goals: visibleGoals,
    rewards: visibleRewards,
    mobileDevices: mobileDevicesRaw
      .filter((device) => session.role === "SUPER_ADMIN" || device.agentId === currentAgent?.id)
      .map((device) => ({ id: device.id, agentId: device.agentId, deviceId: device.deviceId, deviceName: device.deviceName, manufacturer: device.manufacturer ?? "", model: device.model ?? "", simLabel: device.simLabel ?? "", officeSimNumber: device.officeSimNumber ?? "", recordingCapability: device.recordingCapability, recordingEnabled: device.recordingEnabled, lastSeenAt: device.lastSeenAt.toISOString(), isActive: device.isActive })),
    mobileCalls: mobileCallsRaw
      .filter((call) => session.role === "SUPER_ADMIN" || call.agentId === currentAgent?.id)
      .map((call) => ({ id: call.id, assignmentId: call.assignmentId, agentId: call.agentId, customerName: call.assignment.customerName, phoneNumber: call.phoneNumber, deviceName: call.device?.deviceName ?? "", deviceModel: [call.device?.manufacturer, call.device?.model].filter(Boolean).join(" "), status: call.status, outcome: call.outcome ?? "", note: call.note ?? "", durationSeconds: call.durationSeconds ?? 0, recordingStatus: call.recordingStatus, recordingError: call.recordingError ?? "", noteSubmitted: call.noteSubmitted, startedAt: call.startedAt.toISOString(), endedAt: iso(call.endedAt) })),
    reports: buildReports({ agents: visibleAgents, leadPool: visibleLeadPool, leads: visibleLeads, deals: visibleDeals, earnings: visibleEarnings, payouts: visiblePayouts, referralEvents: visibleReferralEvents }),
  } satisfies SalesDashboardSnapshot;
}

export type UpsertSalesAgentInput = {
  userId: string;
  displayName?: string;
  email?: string;
  phone?: string;
  status?: SalesAgentStatus;
  groupId?: string | null;
  parentAgentId?: string | null;
  canCreateSubAgents?: boolean;
  canClaimLeads?: boolean;
  maxActiveLeads?: number | null;
};

async function upsertSalesAgentWithDatabase(input: UpsertSalesAgentInput, database: SalesAgentWriteClient) {
  const existingUser = await database.appAuthUser.findUnique({ where: { id: input.userId } });
  if (!existingUser) throw new Error("Sales auth user was not found.");

  // A profile without a SALES_AGENT login role is an unusable CRM account: it
  // remains visible to admins (and keeps its leads) but is rejected by the
  // mobile login scope. Normalize legacy/linked accounts whenever they are
  // saved as sales agents.
  const user =
    existingUser.role === "SALES_AGENT" && existingUser.assignedRole === "SALES_AGENT" && existingUser.permissions.includes("sales_agent")
      ? existingUser
      : await database.appAuthUser.update({
          where: { id: existingUser.id },
          data: {
            role: "SALES_AGENT",
            assignedRole: "SALES_AGENT",
            permissions: Array.from(new Set([...(existingUser.permissions ?? []), "sales_agent"])),
          },
        });
  const existing = await database.salesAgentProfile.findUnique({ where: { userId: input.userId } });
  if (existing) {
    const updated = await database.salesAgentProfile.update({
      where: { id: existing.id },
      data: {
        status: input.status ?? existing.status,
        groupId: input.groupId === undefined ? existing.groupId : input.groupId?.trim() || null,
        parentAgentId: input.parentAgentId === undefined ? existing.parentAgentId : input.parentAgentId?.trim() || null,
        canCreateSubAgents: input.canCreateSubAgents ?? existing.canCreateSubAgents,
        canClaimLeads: input.canClaimLeads ?? existing.canClaimLeads,
        maxActiveLeads: input.maxActiveLeads === undefined ? existing.maxActiveLeads : input.maxActiveLeads,
      },
      include: { user: true },
    });
    return mapAgent(updated);
  }

  const code = await generateAgentCode(input.displayName || user.displayName, database);
  const created = await database.salesAgentProfile.create({
    data: {
      userId: input.userId,
      groupId: input.groupId?.trim() || "sales-group-main",
      parentAgentId: input.parentAgentId?.trim() || null,
      agentCode: code,
      status: input.status ?? "PENDING",
      canCreateSubAgents: input.canCreateSubAgents ?? false,
      canClaimLeads: input.canClaimLeads ?? true,
      maxActiveLeads: input.maxActiveLeads ?? 3,
      referralCodes: {
        create: {
          code,
          label: "Default package referral link",
        },
      },
    },
    include: { user: true },
  });
  return mapAgent(created);
}

export async function upsertSalesAgent(input: UpsertSalesAgentInput) {
  await ensureSalesDefaults();
  return upsertSalesAgentWithDatabase(input, prisma);
}

export async function createSalesAgentAccount(input: Omit<UpsertSalesAgentInput, "userId"> & { password: string; createdByUserId?: string | null }) {
  await ensureAuthStoreReady();
  await ensureSalesDefaults();
  const groupId = input.groupId?.trim() || "sales-group-main";
  const parentAgentId = input.parentAgentId?.trim() || null;

  return prisma.$transaction(async (transaction) => {
    const [group, parentAgent] = await Promise.all([
      transaction.salesAgentGroup.findUnique({ where: { id: groupId }, select: { id: true } }),
      parentAgentId ? transaction.salesAgentProfile.findUnique({ where: { id: parentAgentId }, select: { id: true } }) : null,
    ]);
    if (!group) return { ok: false as const, error: "Choose a valid sales group." };
    if (parentAgentId && !parentAgent) return { ok: false as const, error: "Choose a valid parent sales agent." };

    const created = await createInternalUser(
      {
        role: "SALES_AGENT",
        displayName: input.displayName ?? "",
        email: input.email ?? "",
        phone: input.phone ?? "",
        password: input.password,
        createdByUserId: input.createdByUserId ?? undefined,
      },
      { transaction, skipBootstrap: true },
    );
    if (!created.ok) return created;

    const agent = await upsertSalesAgentWithDatabase(
      {
        ...input,
        userId: created.user.id,
        displayName: created.user.displayName,
        email: created.user.email ?? input.email,
        phone: created.user.phone,
        groupId,
        parentAgentId,
      },
      transaction,
    );
    return { ok: true as const, user: created.user, agent };
  });
}

export async function updateSalesAgentProfile(input: {
  agentId: string;
  status?: SalesAgentStatus;
  groupId?: string | null;
  parentAgentId?: string | null;
  commissionPercent?: number | null;
  canCreateSubAgents?: boolean;
  canClaimLeads?: boolean;
  maxActiveLeads?: number | null;
  permissions?: Record<string, unknown> | null;
}) {
  const updated = await prisma.salesAgentProfile.update({
    where: { id: input.agentId },
    data: {
      status: input.status,
      groupId: input.groupId,
      parentAgentId: input.parentAgentId,
      commissionPercent: input.commissionPercent,
      canCreateSubAgents: input.canCreateSubAgents,
      canClaimLeads: input.canClaimLeads,
      maxActiveLeads: input.maxActiveLeads,
      permissions: input.permissions === undefined ? undefined : input.permissions === null ? Prisma.JsonNull : (input.permissions as Prisma.InputJsonObject),
    },
    include: { user: true },
  });
  return mapAgent(updated);
}

export async function resetSalesAgentPasswordFromAdmin(input: { agentId: string; password: string }) {
  const agentId = input.agentId.trim();
  const password = input.password.trim();
  if (!agentId || password.length < 8) {
    return { ok: false as const, error: "Agent and an 8 character password are required." };
  }

  const agent = await prisma.salesAgentProfile.findUnique({
    where: { id: agentId },
    include: { user: true },
  });
  if (!agent) {
    return { ok: false as const, error: "Sales agent was not found." };
  }

  const salt = randomBytes(16).toString("hex");
  await prisma.appAuthUser.update({
    where: { id: agent.userId },
    data: {
      // Repair legacy profile/user mismatches in the same atomic account
      // update. This changes neither the SalesAgentProfile id nor any lead,
      // deal, referral, payout, or assignment relation.
      role: "SALES_AGENT",
      assignedRole: "SALES_AGENT",
      permissions: Array.from(new Set([...(agent.user.permissions ?? []), "sales_agent"])),
      passwordSalt: salt,
      passwordHash: hashPassword(password, salt),
      lastLoginAt: null,
    },
  });

  return { ok: true as const };
}

export async function deleteSalesAgentFromAdmin(input: { agentId: string }) {
  const agentId = input.agentId.trim();
  if (!agentId) {
    return { ok: false as const, error: "Agent is required." };
  }

  const agent = await prisma.salesAgentProfile.findUnique({
    where: { id: agentId },
    include: { user: true },
  });
  if (!agent || agent.user.role !== "SALES_AGENT") {
    return { ok: false as const, error: "Sales agent was not found." };
  }
  if (agent.user.isSeeded) {
    return { ok: false as const, error: "Seeded sales agents cannot be deleted from this panel." };
  }

  await prisma.$transaction([
    prisma.salesLeadPoolItem.updateMany({
      where: {
        OR: [{ assignedAgentId: agentId }, { claimedByAgentId: agentId }],
      },
      data: {
        assignedAgentId: null,
        claimedByAgentId: null,
        claimedAt: null,
        status: "OPEN",
      },
    }),
    prisma.salesAgentProfile.updateMany({
      where: { parentAgentId: agentId },
      data: { parentAgentId: null },
    }),
    prisma.salesCommissionRule.updateMany({
      where: { agentId },
      data: { agentId: null, scope: "ALL_AGENTS" },
    }),
    prisma.appAuthUser.delete({ where: { id: agent.userId } }),
  ]);

  return { ok: true as const };
}

export async function updateSalesSettings(patch: Partial<SalesModuleSettings>) {
  await ensureSalesDefaults();
  let leadConfig = await getSalesLeadConfig();
  if (typeof patch.leadGrabEnabled === "boolean") {
    leadConfig = await updateSalesLeadConfig({ leadGrabEnabled: patch.leadGrabEnabled });
  }
  const settings = await prisma.salesSettings.update({
    where: { id: "sales-settings" },
    data: {
      moduleEnabled: patch.moduleEnabled,
      signupRequiresApproval: patch.signupRequiresApproval,
      defaultCommissionPercent: patch.defaultCommissionPercent,
      payoutMinimum: patch.payoutMinimum,
      enableAnnouncements: patch.enableAnnouncements,
      enableMessages: patch.enableMessages,
      enableReferralLinks: patch.enableReferralLinks,
      enableTeams: patch.enableTeams,
      enableEarnings: patch.enableEarnings,
      enablePayouts: patch.enablePayouts,
      enablePackageLinks: patch.enablePackageLinks,
      dashboardPrimaryColor: patch.dashboardPrimaryColor,
      dashboardAccentColor: patch.dashboardAccentColor,
    },
  });
  return mapSettings(settings, leadConfig);
}

export async function saveSalesGroup(input: { id?: string; name: string; description?: string; defaultCommissionPercent: number; parentCommissionPercent?: number; isActive?: boolean }) {
  await ensureSalesDefaults();
  const data = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    defaultCommissionPercent: input.defaultCommissionPercent,
    parentCommissionPercent: input.parentCommissionPercent ?? 0,
    isActive: input.isActive ?? true,
  };
  if (!data.name) throw new Error("Group name is required.");
  return input.id
    ? prisma.salesAgentGroup.update({ where: { id: input.id }, data })
    : prisma.salesAgentGroup.create({ data });
}

export async function createSalesLeadPoolItem(input: {
  assignedAgentId?: string | null;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  source?: string;
  serviceInterest?: string;
  segment?: string;
  priority?: string;
  budgetAmount?: number;
  notes?: string;
  conversationId?: string | null;
}) {
  await ensureSalesDefaults();
  const leadConfig = await getSalesLeadConfig();
  const conversationId = input.conversationId?.trim() || null;
  if (conversationId) {
    const existing = await prisma.salesLeadPoolItem.findUnique({ where: { conversationId } });
    if (existing) return mapLeadPoolItem(existing);
  }

  // When lead grab feature is turned off (default), auto-assign to Anshita Gaur directly
  const shouldAutoAssign = !leadConfig.leadGrabEnabled && !input.assignedAgentId?.trim();
  const targetAgentId = shouldAutoAssign
    ? leadConfig.autoAssignAgentId
    : (input.assignedAgentId?.trim() || null);
  const poolStatus = shouldAutoAssign ? "CLAIMED" : "OPEN";

  try {
    const lead = await prisma.salesLeadPoolItem.create({
      data: {
        assignedAgentId: targetAgentId,
        claimedByAgentId: shouldAutoAssign ? targetAgentId : null,
        claimedAt: shouldAutoAssign ? new Date() : null,
        status: poolStatus,
        conversationId,
        customerName: input.customerName.trim(),
        customerPhone: input.customerPhone?.trim() || null,
        customerEmail: input.customerEmail?.trim() || null,
        source: input.source?.trim() || "round_robin",
        serviceInterest: input.serviceInterest?.trim() || "Editor package",
        segment: input.segment?.trim() || null,
        priority: input.priority?.trim() || "normal",
        budgetAmount: Number.isFinite(Number(input.budgetAmount)) ? Number(input.budgetAmount) : null,
        notes: input.notes?.trim() || null,
      },
    });

    // If auto-assigned, create SalesLeadAssignment immediately so it appears on Anshita's board
    if (shouldAutoAssign && targetAgentId) {
      try {
        const assignment = await prisma.salesLeadAssignment.create({
          data: {
            assignedAgentId: targetAgentId,
            customerName: input.customerName.trim(),
            customerPhone: input.customerPhone?.trim() || null,
            conversationId,
            customerEmail: input.customerEmail?.trim() || null,
            source: input.source?.trim() || "whatsapp_meta_ad",
            serviceInterest: input.serviceInterest?.trim() || "Agency Package",
            segment: input.segment?.trim() || null,
            priority: input.priority?.trim() || "hot",
            budgetAmount: Number.isFinite(Number(input.budgetAmount)) ? Number(input.budgetAmount) : null,
            stage: "NEW",
            notes: input.notes?.trim() || `Auto-assigned directly to ${leadConfig.autoAssignAgentName} (Lead grab queue disabled)`,
            activityLogs: {
              create: {
                action: "AUTO_ASSIGNED",
                note: `Lead auto-assigned directly to ${leadConfig.autoAssignAgentName}.`,
              },
            },
          },
        });
        await prisma.salesLeadPoolItem.update({
          where: { id: lead.id },
          data: { convertedAssignmentId: assignment.id },
        });
      } catch (assignErr) {
        console.error("[sales-store] Auto-assignment creation error:", assignErr);
      }
    }

    return mapLeadPoolItem(lead);
  } catch (error) {
    if (conversationId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.salesLeadPoolItem.findUnique({ where: { conversationId } });
      if (existing) return mapLeadPoolItem(existing);
    }
    throw error;
  }
}

function normalizeSalesConversationPhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

async function findSalesConversationIdByPhone(phone: string | null | undefined) {
  const normalizedPhone = normalizeSalesConversationPhone(phone);
  if (!normalizedPhone) return null;

  // AppConversation predates the sales module and stores phone values in
  // different display formats. Match only a complete 10-digit number and use
  // the most recently active thread when a customer has returned.
  const candidates = await prisma.appConversation.findMany({
    select: { customerPhone: true, id: true },
    orderBy: { updatedAt: "desc" },
    take: 2_000,
  });
  return candidates.find((conversation) => normalizeSalesConversationPhone(conversation.customerPhone) === normalizedPhone)?.id ?? null;
}

export async function linkSalesLeadConversation(leadId: string) {
  const lead = await prisma.salesLeadAssignment.findUnique({
    where: { id: leadId },
    select: { conversationId: true, customerPhone: true, id: true },
  });
  if (!lead) return null;
  if (lead.conversationId) return lead.conversationId;

  const conversationId = await findSalesConversationIdByPhone(lead.customerPhone);
  if (!conversationId) return null;
  await prisma.salesLeadAssignment.update({ where: { id: lead.id }, data: { conversationId } });
  return conversationId;
}

export async function syncSalesAgentConversationLinks(agentId: string) {
  const leads = await prisma.salesLeadAssignment.findMany({
    where: { assignedAgentId: agentId, conversationId: null },
    select: { customerPhone: true, id: true },
    take: 500,
  });
  if (!leads.length) return { linked: 0, scanned: 0 };

  const conversations = await prisma.appConversation.findMany({
    select: { customerPhone: true, id: true },
    orderBy: { updatedAt: "desc" },
    take: 2_000,
  });
  const conversationByPhone = new Map<string, string>();
  for (const conversation of conversations) {
    const phone = normalizeSalesConversationPhone(conversation.customerPhone);
    if (phone && !conversationByPhone.has(phone)) conversationByPhone.set(phone, conversation.id);
  }
  const updates = leads.flatMap((lead) => {
    const conversationId = conversationByPhone.get(normalizeSalesConversationPhone(lead.customerPhone));
    return conversationId
      ? [prisma.salesLeadAssignment.updateMany({ where: { id: lead.id, conversationId: null }, data: { conversationId } })]
      : [];
  });
  if (!updates.length) return { linked: 0, scanned: leads.length };
  const results = await prisma.$transaction(updates);
  return { linked: results.reduce((total, result) => total + result.count, 0), scanned: leads.length };
}

async function sendSalesLeadAssignmentPush(lead: { assignedAgentId: string; customerName: string; id: string; priority: string; serviceInterest: string | null }) {
  const agent = await prisma.salesAgentProfile.findUnique({ where: { id: lead.assignedAgentId }, select: { userId: true } });
  if (!agent) return { attempted: 0, sent: 0, skipped: "agent_missing" as const };
  const tokens = await listMobilePushTokens({ activeOnly: true, userId: agent.userId });
  if (!tokens.length) return { attempted: 0, sent: 0, skipped: "no_active_token" as const };
  return sendMobilePushNotifications(tokens, {
    title: "New lead assigned",
    body: `${lead.customerName} · ${lead.serviceInterest || "Sales enquiry"}`,
    data: {
      leadId: lead.id,
      notificationChannelId: "gigxomi-sales-leads",
      priority: lead.priority,
      type: "sales_lead_assigned",
    },
  });
}

export async function claimSalesLeadPoolItem(input: { poolItemId: string; agentId: string; actorUserId?: string | null }) {
  await ensureSalesDefaults();
  const agent = await prisma.salesAgentProfile.findUnique({ where: { id: input.agentId }, include: { user: true } });
  if (!agent || agent.status !== "ACTIVE" || !agent.canClaimLeads) {
    throw new Error("This sales agent cannot claim queue leads right now.");
  }
  if (agent.maxActiveLeads) {
    const activeLeadCount = await prisma.salesLeadAssignment.count({
      where: {
        assignedAgentId: agent.id,
        stage: { in: ["NEW", "CONTACTED", "QUALIFIED", "QUOTE_SENT", "PAYMENT_PENDING"] },
      },
    });
    if (activeLeadCount >= agent.maxActiveLeads) {
      throw new Error(`You already have ${activeLeadCount} active leads. Finish or close one before grabbing another.`);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const poolItem = await tx.salesLeadPoolItem.findUnique({ where: { id: input.poolItemId } });
    if (!poolItem || poolItem.status !== "OPEN") {
      throw new Error("This lead has already been claimed.");
    }
    if (poolItem.assignedAgentId && poolItem.assignedAgentId !== agent.id) {
      throw new Error("This lead is reserved for another sales agent.");
    }

    const assignment = await tx.salesLeadAssignment.create({
      data: {
        assignedAgentId: agent.id,
        createdById: input.actorUserId ?? null,
        customerName: poolItem.customerName,
        customerPhone: poolItem.customerPhone,
        conversationId: poolItem.conversationId,
        customerEmail: poolItem.customerEmail,
        source: poolItem.source,
        serviceInterest: poolItem.serviceInterest ?? "Editor package",
        segment: poolItem.segment,
        priority: poolItem.priority,
        budgetAmount: poolItem.budgetAmount,
        stage: "NEW",
        notes: poolItem.notes,
        activityLogs: {
          create: {
            actorUserId: input.actorUserId ?? null,
            action: "LEAD_CLAIMED",
            note: "Lead grabbed from the round-robin queue.",
          },
        },
      },
    });
    const updatedPoolItem = await tx.salesLeadPoolItem.update({
      where: { id: poolItem.id },
      data: {
        claimedByAgentId: agent.id,
        convertedAssignmentId: assignment.id,
        status: "CLAIMED",
        claimedAt: new Date(),
      },
    });
    return { poolItem: mapLeadPoolItem(updatedPoolItem), lead: mapLead(assignment) };
  });
  await linkSalesLeadConversation(result.lead.id);
  const linkedLead = await prisma.salesLeadAssignment.findUnique({ where: { id: result.lead.id } });
  void sendSalesLeadAssignmentPush(linkedLead ?? result.lead).catch(() => undefined);
  return { ...result, lead: linkedLead ? mapLead(linkedLead) : result.lead };
}

export async function createSalesLead(input: Partial<SalesLeadView> & { assignedAgentId: string; customerName: string; actorUserId?: string | null }) {
  await ensureSalesDefaults();
  const lead = await prisma.salesLeadAssignment.create({
    data: {
      assignedAgentId: input.assignedAgentId,
      createdById: input.actorUserId ?? null,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone?.trim() || null,
      customerEmail: input.customerEmail?.trim() || null,
      source: input.source?.trim() || "manual",
      serviceInterest: input.serviceInterest?.trim() || "Editor package",
      segment: input.segment?.trim() || null,
      priority: input.priority?.trim() || "normal",
      tags: input.tags ?? [],
      conversationId: input.conversationId?.trim() || null,
      budgetAmount: input.budgetAmount ?? null,
      stage: input.stage ?? "NEW",
      followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
      lastContactedAt: input.lastContactedAt ? new Date(input.lastContactedAt) : null,
      notes: input.notes?.trim() || null,
      activityLogs: {
        create: {
          actorUserId: input.actorUserId ?? null,
          action: "LEAD_CREATED",
          note: input.notes?.trim() || "Lead created.",
        },
      },
    },
  });
  await linkSalesLeadConversation(lead.id);
  const linkedLead = await prisma.salesLeadAssignment.findUnique({ where: { id: lead.id } });
  void sendSalesLeadAssignmentPush(linkedLead ?? lead).catch(() => undefined);
  return mapLead(linkedLead ?? lead);
}

export async function updateSalesLead(input: {
  leadId: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  serviceInterest?: string;
  segment?: string;
  priority?: string;
  tags?: string[];
  budgetAmount?: number | null;
  followUpAt?: string | null;
  lastContactedAt?: string | null;
  notes?: string;
  conversationId?: string | null;
  actorUserId?: string | null;
}) {
  const lead = await prisma.salesLeadAssignment.update({
    where: { id: input.leadId },
    data: {
      customerName: input.customerName?.trim() || undefined,
      customerPhone: input.customerPhone === undefined ? undefined : input.customerPhone.trim() || null,
      customerEmail: input.customerEmail === undefined ? undefined : input.customerEmail.trim() || null,
      serviceInterest: input.serviceInterest === undefined ? undefined : input.serviceInterest.trim() || null,
      segment: input.segment === undefined ? undefined : input.segment.trim() || null,
      priority: input.priority === undefined ? undefined : input.priority.trim() || "normal",
      tags: input.tags,
      budgetAmount: input.budgetAmount === undefined ? undefined : input.budgetAmount,
      followUpAt: input.followUpAt === undefined ? undefined : input.followUpAt ? new Date(input.followUpAt) : null,
      lastContactedAt: input.lastContactedAt === undefined ? undefined : input.lastContactedAt ? new Date(input.lastContactedAt) : null,
      notes: input.notes === undefined ? undefined : input.notes.trim() || null,
      conversationId: input.conversationId === undefined ? undefined : input.conversationId?.trim() || null,
      activityLogs: {
        create: {
          actorUserId: input.actorUserId ?? null,
          action: "LEAD_UPDATED",
          note: "Lead CRM fields updated.",
        },
      },
    },
  });
  return mapLead(lead);
}

export async function updateSalesLeadStage(input: { leadId: string; stage: SalesLeadStage; note?: string; actorUserId?: string | null }) {
  const lead = await prisma.salesLeadAssignment.update({
    where: { id: input.leadId },
    data: {
      stage: input.stage,
      lastContactedAt: input.stage === "CONTACTED" ? new Date() : undefined,
      activityLogs: {
        create: {
          actorUserId: input.actorUserId ?? null,
          action: input.stage,
          note: input.note?.trim() || null,
        },
      },
    },
  });
  return mapLead(lead);
}

async function calculateCommission(input: {
  agent: Prisma.SalesAgentProfileGetPayload<{ include: { group: true } }>;
  paidAmount: number;
  packageId?: string | null;
  serviceId?: string | null;
}) {
  const now = new Date();
  const rules = await prisma.salesCommissionRule.findMany({
    where: {
      isActive: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });
  const rule =
    rules.find((item) => {
      if (item.minOrderValue !== null && input.paidAmount < toNumber(item.minOrderValue)) return false;
      if (item.maxOrderValue !== null && input.paidAmount > toNumber(item.maxOrderValue)) return false;
      if (item.scope === "AGENT_GROUP" && item.groupId !== input.agent.groupId) return false;
      if (item.scope === "INDIVIDUAL_AGENT" && item.agentId !== input.agent.id) return false;
      if (item.appliesTo === "PACKAGE" && item.packageId !== input.packageId) return false;
      if (item.appliesTo === "SERVICE" && item.serviceId !== input.serviceId) return false;
      return true;
    }) ?? null;
  const defaultPercent = toNumber(input.agent.commissionPercent ?? input.agent.group?.defaultCommissionPercent ?? 10);
  const amount = rule ? (rule.type === "FIXED" ? toNumber(rule.value) : (input.paidAmount * toNumber(rule.value)) / 100) : (input.paidAmount * defaultPercent) / 100;
  const parentPercent = toNumber(rule?.parentCommissionPercent ?? input.agent.group?.parentCommissionPercent ?? 0);
  return {
    ruleId: rule?.id ?? null,
    amount: Math.round(amount * 100) / 100,
    parentAmount: input.agent.parentAgentId ? Math.round(((input.paidAmount * parentPercent) / 100) * 100) / 100 : 0,
  };
}

export async function createSalesDeal(input: Partial<SalesDealView> & { assignmentId: string; agentId: string; title: string; agreedAmount: number }) {
  const paidAmount = Number(input.paidAmount ?? 0);
  const status = input.status ?? (paidAmount > 0 ? "PAID" : "DRAFT");
  const deal = await prisma.salesDeal.create({
    data: {
      assignmentId: input.assignmentId,
      agentId: input.agentId,
      title: input.title.trim(),
      packageId: input.packageId ?? null,
      serviceId: input.serviceId ?? null,
      quoteId: input.quoteId ?? null,
      referralCodeId: input.referralCodeId ?? null,
      paymentTransactionId: input.paymentTransactionId ?? null,
      agreedAmount: input.agreedAmount,
      paidAmount,
      status,
      paymentReference: input.paymentReference ?? null,
      handoffNotes: input.handoffNotes ?? null,
      closedAt: status === "PAID" ? new Date() : null,
    },
    include: { package: true, service: true },
  });
  if (status === "PAID") {
    await createEarningsForDeal(deal.id);
  }
  return mapDeal(deal);
}

async function createEarningsForDeal(dealId: string) {
  const deal = await prisma.salesDeal.findUnique({
    where: { id: dealId },
    include: { agent: { include: { group: true } }, earnings: true },
  });
  if (!deal || deal.earnings.length || !["PAID", "HANDOFF", "CLOSED"].includes(deal.status)) return;
  const commission = await calculateCommission({
    agent: deal.agent,
    paidAmount: toNumber(deal.paidAmount),
    packageId: deal.packageId,
    serviceId: deal.serviceId,
  });
  const createdAt = new Date();
  const earnings: Prisma.SalesEarningCreateManyInput[] = [
    {
      dealId: deal.id,
      agentId: deal.agentId,
      ruleId: commission.ruleId,
      amount: commission.amount,
      parentAmount: commission.parentAmount,
      status: "APPROVED",
      approvedAt: createdAt,
    },
  ];
  if (deal.agent.parentAgentId && commission.parentAmount > 0) {
    earnings.push({
      dealId: deal.id,
      agentId: deal.agent.parentAgentId,
      ruleId: commission.ruleId,
      amount: commission.parentAmount,
      parentAmount: 0,
      status: "APPROVED",
      approvedAt: createdAt,
    });
  }
  await prisma.salesEarning.createMany({ data: earnings });
}

export async function saveCommissionRule(input: Partial<Prisma.SalesCommissionRuleUncheckedCreateInput> & { name: string; type: SalesCommissionRuleType; value: number }) {
  await ensureSalesDefaults();
  const data = {
    name: input.name.trim(),
    type: input.type,
    scope: (input.scope ?? "ALL_AGENTS") as SalesCommissionScope,
    appliesTo: (input.appliesTo ?? "ALL_PACKAGES") as SalesCommissionAppliesTo,
    groupId: input.groupId ?? null,
    agentId: input.agentId ?? null,
    packageId: input.packageId ?? null,
    serviceId: input.serviceId ?? null,
    value: input.value,
    parentCommissionPercent: input.parentCommissionPercent ?? null,
    minOrderValue: input.minOrderValue ?? null,
    maxOrderValue: input.maxOrderValue ?? null,
    priority: Number(input.priority ?? 0),
    isActive: input.isActive ?? true,
  };
  return input.id
    ? prisma.salesCommissionRule.update({ where: { id: input.id }, data })
    : prisma.salesCommissionRule.create({ data });
}

export async function requestSalesPayout(input: { agentId: string; amount: number; note?: string }) {
  const settings = await ensureSalesDefaults();
  const minimum = toNumber(settings.payoutMinimum);
  if (input.amount < minimum) throw new Error(`Minimum payout is ${minimum}.`);
  const earnings = await prisma.salesEarning.findMany({
    where: { agentId: input.agentId, status: "APPROVED", payoutId: null },
    orderBy: { createdAt: "asc" },
  });
  const available = earnings.reduce((sum, item) => sum + toNumber(item.amount), 0);
  if (input.amount > available) throw new Error("Requested payout is higher than available approved earnings.");
  const payout = await prisma.salesPayout.create({
    data: { agentId: input.agentId, amount: input.amount, note: input.note?.trim() || null },
  });
  let remaining = input.amount;
  for (const earning of earnings) {
    if (remaining <= 0) break;
    await prisma.salesEarning.update({ where: { id: earning.id }, data: { payoutId: payout.id } });
    remaining -= toNumber(earning.amount);
  }
  return mapPayout(payout);
}

export async function updateSalesPayoutStatus(input: { payoutId: string; status: SalesPayoutStatus; note?: string }) {
  const now = new Date();
  const payout = await prisma.salesPayout.update({
    where: { id: input.payoutId },
    data: {
      status: input.status,
      note: input.note?.trim() || undefined,
      approvedAt: input.status === "APPROVED" ? now : undefined,
      paidAt: input.status === "PAID" ? now : undefined,
      earnings: input.status === "PAID" ? { updateMany: { where: { payoutId: input.payoutId }, data: { status: "PAID", paidAt: now } } } : undefined,
    },
  });
  if (input.status === "REJECTED") {
    await prisma.salesEarning.updateMany({ where: { payoutId: payout.id, status: "APPROVED" }, data: { payoutId: null } });
  }
  return mapPayout(payout);
}

export async function saveSalesPayoutInfo(input: { agentId: string; payoutInfo: Record<string, unknown> }) {
  const updated = await prisma.salesAgentProfile.update({
    where: { id: input.agentId },
    data: { payoutInfo: input.payoutInfo as Prisma.InputJsonObject },
    include: { user: true },
  });
  return mapAgent(updated);
}

export async function createSalesMessage(input: { agentId?: string | null; subject: string; body: string; author: string }) {
  const now = new Date().toISOString();
  return prisma.salesMessageThread.create({
    data: {
      agentId: input.agentId ?? null,
      subject: input.subject.trim(),
      messages: [{ author: input.author, body: input.body.trim(), createdAt: now }],
      status: "open",
    },
  });
}

export async function replySalesMessage(input: { threadId: string; body: string; author: string; close?: boolean }) {
  const thread = await prisma.salesMessageThread.findUnique({ where: { id: input.threadId } });
  if (!thread) throw new Error("Message thread not found.");
  const messages = readJsonMessages(thread.messages);
  messages.push({ author: input.author, body: input.body.trim(), createdAt: new Date().toISOString() });
  return prisma.salesMessageThread.update({
    where: { id: input.threadId },
    data: { messages, status: input.close ? "closed" : thread.status },
  });
}

export async function saveSalesAnnouncement(input: { title: string; body: string; audience?: string; isActive?: boolean }) {
  return prisma.salesAnnouncement.create({
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      audience: input.audience?.trim() || "all",
      isActive: input.isActive ?? true,
    },
  });
}

export async function saveSalesGoal(input: {
  id?: string;
  name: string;
  metric: SalesGoalMetric;
  scope?: SalesGoalScope;
  agentId?: string | null;
  groupId?: string | null;
  target: number;
  rewardText?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  isPinned?: boolean;
  isActive?: boolean;
}) {
  await ensureSalesDefaults();
  const data = {
    name: input.name.trim(),
    metric: input.metric,
    scope: input.scope ?? "INDIVIDUAL_AGENT",
    agentId: input.agentId?.trim() || null,
    groupId: input.groupId?.trim() || null,
    target: Math.max(Number(input.target ?? 0), 1),
    rewardText: input.rewardText?.trim() || null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    isPinned: input.isPinned ?? true,
    isActive: input.isActive ?? true,
  };
  if (!data.name) throw new Error("Goal name is required.");
  return input.id
    ? prisma.salesGoal.update({ where: { id: input.id }, data })
    : prisma.salesGoal.create({ data });
}

export async function saveSalesReward(input: {
  id?: string;
  title: string;
  body: string;
  agentId?: string | null;
  groupId?: string | null;
  isPinned?: boolean;
  isActive?: boolean;
}) {
  await ensureSalesDefaults();
  const data = {
    title: input.title.trim(),
    body: input.body.trim(),
    agentId: input.agentId?.trim() || null,
    groupId: input.groupId?.trim() || null,
    isPinned: input.isPinned ?? true,
    isActive: input.isActive ?? true,
  };
  if (!data.title || !data.body) throw new Error("Reward title and body are required.");
  return input.id
    ? prisma.salesReward.update({ where: { id: input.id }, data })
    : prisma.salesReward.create({ data });
}

function findStringDeep(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  for (const nested of Object.values(record)) {
    const found = findStringDeep(nested, keys);
    if (found) return found;
  }
  return "";
}

export async function processSalesPaymentSuccess(transactionId: string) {
  await ensureSalesDefaults();
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id: transactionId },
    include: { user: true, package: true, salesDeal: true },
  });
  if (!transaction || transaction.status !== "SUCCESS" || transaction.salesDeal) {
    return { ok: true as const, skipped: true };
  }
  const rawCode =
    findStringDeep(transaction.rawRequest, ["salesReferralCode", "referralCode", "ref"]) ||
    findStringDeep(transaction.rawResponse, ["salesReferralCode", "referralCode", "ref"]);
  const attributionEvent = !rawCode
    ? await prisma.salesReferralEvent.findFirst({
        where: {
          OR: [
            { paymentTransactionId: transaction.id },
            { userId: transaction.userId, packageId: transaction.packageId },
          ],
          eventType: { in: ["PAYMENT_STARTED", "SIGNUP_VERIFIED", "SIGNUP_STARTED", "PRICING_VIEW"] },
        },
        orderBy: { createdAt: "desc" },
        include: { referralCode: { include: { agent: { include: { user: true, group: true } } } } },
      })
    : null;
  const referral = rawCode ? await findActiveReferralCode(rawCode) : attributionEvent?.referralCode ?? null;
  if (!referral) {
    return { ok: true as const, skipped: true };
  }
  await trackSalesReferralEvent({
    code: referral.code,
    eventType: "PAYMENT_SUCCESS",
    packageId: transaction.packageId,
    userId: transaction.userId,
    paymentTransactionId: transaction.id,
    eventKey: `payment-success:${transaction.id}`,
    metadata: { amount: toNumber(transaction.amount), provider: transaction.provider },
  });
  const lead = await prisma.salesLeadAssignment.create({
    data: {
      assignedAgentId: referral.agentId,
      customerName: transaction.user.displayName,
      customerPhone: transaction.user.phone,
      customerEmail: transaction.user.email,
      source: "referral",
      serviceInterest: transaction.package.name,
      segment: transaction.package.packageType.toLowerCase(),
      priority: "hot",
      budgetAmount: transaction.amount,
      stage: "PAID",
      notes: `Auto-created from paid package transaction ${transaction.merchantTransactionId ?? transaction.id}.`,
    },
  });
  const deal = await prisma.salesDeal.create({
    data: {
      assignmentId: lead.id,
      agentId: referral.agentId,
      packageId: transaction.packageId,
      referralCodeId: referral.id,
      paymentTransactionId: transaction.id,
      title: `${transaction.package.name} package sale`,
      agreedAmount: transaction.amount,
      paidAmount: transaction.amount,
      status: "PAID",
      paymentReference: transaction.merchantTransactionId ?? transaction.merchantOrderId ?? transaction.id,
      closedAt: transaction.paidAt ?? new Date(),
      handoffNotes: "Created from referral-tracked package payment.",
    },
  });
  await createEarningsForDeal(deal.id);
  await trackSalesReferralEvent({
    code: referral.code,
    eventType: "DEAL_CREATED",
    packageId: transaction.packageId,
    userId: transaction.userId,
    paymentTransactionId: transaction.id,
    dealId: deal.id,
    eventKey: `deal-created:${deal.id}`,
    metadata: { amount: toNumber(transaction.amount), title: deal.title },
  });
  return { ok: true as const, dealId: deal.id };
}
