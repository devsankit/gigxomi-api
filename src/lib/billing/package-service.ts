import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type {
  PackageBillingInterval,
  PackageBillingType,
  PackageFeatureType,
  RegistrationPackage,
  RegistrationPackageAudience,
  RegistrationPackageFeature,
  RegistrationPackageFeatureInput,
  RegistrationPackageType,
} from "@/lib/gigxomi/public-growth-types";

type PackageWithFeatures = Prisma.PackageGetPayload<{
  include: {
    featureValues: {
      include: {
        feature: true;
      };
    };
  };
}>;

type SavePackageInput = Partial<RegistrationPackage> & {
  id?: string;
  featureInputs?: RegistrationPackageFeatureInput[];
};

const DEFAULT_FEATURES: RegistrationPackageFeatureInput[] = [
  {
    featureKey: "profile_access",
    featureLabel: "Profile access",
    featureType: "BOOLEAN",
    category: "Core",
    showInSelectedSummary: true,
    showInRegistrationCompare: true,
    shortDisplayText: "Create your profile",
    sortOrder: 10,
    booleanValue: true,
  },
  {
    featureKey: "service_publishing",
    featureLabel: "Service publishing",
    featureType: "BOOLEAN",
    category: "Core",
    showInSelectedSummary: true,
    showInRegistrationCompare: true,
    shortDisplayText: "Publish services",
    sortOrder: 20,
    booleanValue: true,
  },
  {
    featureKey: "whatsapp_leads",
    featureLabel: "WhatsApp-first leads",
    featureType: "BOOLEAN",
    category: "Growth",
    showInSelectedSummary: true,
    showInRegistrationCompare: true,
    shortDisplayText: "Receive WhatsApp-first leads",
    sortOrder: 30,
    booleanValue: true,
  },
];

const DEFAULT_PACKAGES: Array<SavePackageInput & { id: string; slug: string; audience: RegistrationPackageAudience }> = [
  {
    id: "pkg-freelancer-starter",
    slug: "freelancer-starter",
    name: "Freelancer Starter",
    audience: "FREELANCER",
    packageType: "FREELANCER",
    shortSubtitle: "Best for individual editors",
    description: "Create your profile, publish services, and receive WhatsApp-first leads.",
    badgeText: "Starter",
    ctaLabel: "Start free",
    billingType: "FREE",
    billingInterval: "CUSTOM",
    currency: "INR",
    amount: 0,
    isFree: true,
    paymentRequired: false,
    autoRenewEnabled: false,
    priceLabel: "INR 0",
    billingLabel: "Get started",
    statusLabel: "Best for individual editors",
    featureBullets: ["Create your profile", "Publish services", "Receive WhatsApp-first leads"],
    compareHighlights: ["Profile access", "Service publishing", "WhatsApp leads"],
    serviceLimit: 1,
    activeProjectLimit: 3,
    portfolioItemLimit: 3,
    biddingApplyLimit: 10,
    proposalLimit: 10,
    leadsUnlockLimit: 5,
    featuredListing: false,
    boostProfile: false,
    verificationBadgeEligible: false,
    commissionOverridePercent: 30,
    durationDays: 3650,
    sortOrder: 1,
    isActive: true,
  },
  {
    id: "pkg-freelancer-pro",
    slug: "freelancer-pro",
    name: "Freelancer Pro",
    audience: "FREELANCER",
    packageType: "FREELANCER",
    shortSubtitle: "For frequent editors",
    description: "Priority discovery placement, advanced lead matching, and faster review handling.",
    badgeText: "Popular",
    ctaLabel: "Start free",
    billingType: "FREE",
    billingInterval: "CUSTOM",
    currency: "INR",
    amount: 0,
    priceMonthly: null,
    isFree: true,
    paymentRequired: false,
    autoRenewEnabled: false,
    priceLabel: "₹0",
    billingLabel: "Free forever",
    statusLabel: "For frequent editors",
    featureBullets: ["Priority discovery placement", "Advanced lead matching", "Faster review handling"],
    compareHighlights: ["Priority discovery", "Advanced matching", "Faster review"],
    serviceLimit: 8,
    activeProjectLimit: 25,
    portfolioItemLimit: 20,
    biddingApplyLimit: 60,
    proposalLimit: 60,
    leadsUnlockLimit: 40,
    featuredListing: true,
    boostProfile: true,
    chatAccess: true,
    teamChat: true,
    aiToolsAccess: true,
    analyticsAccess: true,
    advancedAnalytics: true,
    automationTools: true,
    verificationBadgeEligible: true,
    prioritySupport: true,
    commissionOverridePercent: 20,
    durationDays: 3650,
    sortOrder: 2,
    isActive: true,
    isRecommended: true,
  },
  {
    id: "pkg-agency-launch",
    slug: "agency-launch",
    name: "Agency Launch",
    audience: "AGENCY",
    packageType: "AGENCY",
    shortSubtitle: "Agency workspace",
    description: "Agency dashboard access, manager routing, and client WhatsApp intake.",
    badgeText: "Agency",
    ctaLabel: "Get annual access",
    billingType: "RECURRING",
    billingInterval: "YEARLY",
    currency: "INR",
    amount: 12000,
    priceMonthly: null,
    priceYearly: 12000,
    isFree: false,
    paymentRequired: true,
    autoRenewEnabled: true,
    priceLabel: "₹12,000",
    billingLabel: "Per year",
    statusLabel: "Agency workspace",
    featureBullets: ["Agency dashboard access", "Manager routing", "Client WhatsApp intake"],
    compareHighlights: ["Agency dashboard", "Manager routing", "Client intake"],
    serviceLimit: null,
    activeProjectLimit: 10,
    portfolioItemLimit: 25,
    teamMemberLimit: 8,
    staffAccountLimit: 2,
    clientLimit: 100,
    editorFreelancerLimit: 5,
    storageLimitMb: 20480,
    maxUploadSizeMb: 512,
    chatAccess: true,
    clientChat: true,
    teamChat: true,
    whatsappIntegration: true,
    aiToolsAccess: true,
    aiCredits: 2000,
    analyticsAccess: true,
    advancedAnalytics: true,
    invoiceTools: true,
    paymentCollectionTools: true,
    whiteLabelAccess: true,
    brandingCustomization: true,
    automationTools: true,
    apiAccess: true,
    webhookAccess: true,
    prioritySupport: true,
    verificationBadgeEligible: true,
    dedicatedManager: true,
    commissionOverridePercent: null,
    durationDays: 365,
    sortOrder: 3,
    isActive: false,
    isVisibleOnRegistration: false,
    allowRegistration: false,
  },
  {
    id: "pkg-agency-scale",
    slug: "agency-scale",
    name: "Agency Scale",
    audience: "AGENCY",
    packageType: "AGENCY",
    shortSubtitle: "For growing teams",
    description: "Larger team access, marketing integrations, and priority support.",
    badgeText: "Scale",
    ctaLabel: "Get Subscription",
    billingType: "RECURRING",
    billingInterval: "QUARTERLY",
    currency: "INR",
    amount: 11999,
    priceQuarterly: 11999,
    isFree: false,
    paymentRequired: true,
    autoRenewEnabled: true,
    priceLabel: "INR 11,999",
    billingLabel: "Per quarter",
    statusLabel: "For growing teams",
    featureBullets: ["Larger team access", "Marketing integrations", "Priority support"],
    compareHighlights: ["Team access", "Marketing integrations", "Priority support"],
    serviceLimit: null,
    activeProjectLimit: 50,
    portfolioItemLimit: 100,
    teamMemberLimit: 35,
    staffAccountLimit: 8,
    clientLimit: 500,
    editorFreelancerLimit: 25,
    storageLimitMb: 102400,
    maxUploadSizeMb: 2048,
    chatAccess: true,
    clientChat: true,
    teamChat: true,
    whatsappIntegration: true,
    aiToolsAccess: true,
    aiCredits: 2000,
    analyticsAccess: true,
    advancedAnalytics: true,
    invoiceTools: true,
    paymentCollectionTools: true,
    brandingCustomization: true,
    automationTools: true,
    prioritySupport: true,
    dedicatedManager: true,
    commissionOverridePercent: null,
    durationDays: 90,
    sortOrder: 4,
    isActive: false,
    isVisibleOnRegistration: false,
    allowRegistration: false,
  },
  {
    id: "pkg-agency-freemium",
    slug: "agency-freemium",
    name: "Agency Freemium",
    audience: "AGENCY",
    packageType: "AGENCY",
    shortSubtitle: "7-day unrestricted trial",
    description: "Try the core agency workspace for 7 days with assignment access for up to two confirmed editors.",
    badgeText: "7 days free trial",
    ctaLabel: "Start 7-day Free Trial",
    billingType: "FREE",
    billingInterval: "CUSTOM",
    currency: "INR",
    amount: 0,
    isFree: true,
    paymentRequired: false,
    autoRenewEnabled: false,
    priceLabel: "INR 0",
    billingLabel: "Free for 7 days",
    statusLabel: "7-Day Free Trial",
    featureBullets: ["WhatsApp and Instagram inbox", "Invite and confirm freelancers", "Assign active work to 2 distinct editors for 7 days"],
    compareHighlights: ["7-day multichannel workspace", "Confirmed team members", "2 active editors"],
    teamMemberLimit: 2,
    editorFreelancerLimit: 2,
    activeProjectLimit: 5,
    trialEnabled: true,
    trialDays: 7,
    durationDays: 7,
    sortOrder: 3,
    isActive: true,
  },
  {
    id: "pkg-agency-premium",
    slug: "agency-premium",
    name: "Agency Premium",
    audience: "AGENCY",
    packageType: "AGENCY",
    shortSubtitle: "₹17,700/year — one complete agency workspace",
    description: "Choose ₹2,000 monthly or ₹17,700 yearly for unlimited editor assignments, integrations, automation, analytics, and priority support.",
    badgeText: "Premium",
    ctaLabel: "Subscribe to Premium",
    billingType: "RECURRING",
    billingInterval: "MONTHLY",
    currency: "INR",
    amount: 2000,
    priceMonthly: 2000,
    priceYearly: 17700,
    isFree: false,
    paymentRequired: true,
    autoRenewEnabled: true,
    priceLabel: "INR 2,000",
    billingLabel: "Monthly, or INR 17,700 yearly",
    statusLabel: "All agency features unlocked",
    featureBullets: ["Unlimited editor assignments", "All chat and integration features", "Automation, analytics, and priority support"],
    compareHighlights: ["Unlimited editors", "All integrations", "Full automation and analytics"],
    teamMemberLimit: null,
    editorFreelancerLimit: null,
    activeProjectLimit: null,
    durationDays: 30,
    sortOrder: 4,
    isActive: true,
  },
];

function mapDefaultPackage(pkg: SavePackageInput & { id: string; slug: string; audience: RegistrationPackageAudience }): RegistrationPackage {
  const billingType = normalizeBillingType(pkg.billingType, pkg.isFree ? "FREE" : "RECURRING");
  const billingInterval = normalizeBillingInterval(pkg.billingInterval, billingType === "FREE" ? "CUSTOM" : "MONTHLY");
  const amount = Number(pkg.amount ?? 0);
  const currency = pkg.currency ?? "INR";
  const timestamp = new Date().toISOString();

  return {
    id: pkg.id,
    slug: pkg.slug,
    name: pkg.name ?? "Gigxomi package",
    audience: pkg.audience,
    packageType: pkg.packageType ?? pkg.audience,
    shortSubtitle: pkg.shortSubtitle,
    description: pkg.description,
    badgeText: pkg.badgeText,
    ctaLabel: pkg.ctaLabel,
    billingType,
    billingInterval,
    currency,
    amount,
    priceMonthly: pkg.priceMonthly ?? null,
    priceQuarterly: pkg.priceQuarterly ?? null,
    priceYearly: pkg.priceYearly ?? null,
    priceOneTime: pkg.priceOneTime ?? null,
    serviceLimit: pkg.serviceLimit ?? null,
    activeProjectLimit: pkg.activeProjectLimit ?? null,
    portfolioItemLimit: pkg.portfolioItemLimit ?? null,
    teamMemberLimit: pkg.teamMemberLimit ?? null,
    staffAccountLimit: pkg.staffAccountLimit ?? null,
    clientLimit: pkg.clientLimit ?? null,
    editorFreelancerLimit: pkg.editorFreelancerLimit ?? null,
    storageLimitMb: pkg.storageLimitMb ?? null,
    maxUploadSizeMb: pkg.maxUploadSizeMb ?? null,
    chatAccess: pkg.chatAccess ?? false,
    clientChat: pkg.clientChat ?? false,
    teamChat: pkg.teamChat ?? false,
    whatsappIntegration: pkg.whatsappIntegration ?? false,
    aiToolsAccess: pkg.aiToolsAccess ?? false,
    aiCredits: pkg.aiCredits ?? null,
    proposalLimit: pkg.proposalLimit ?? null,
    biddingApplyLimit: pkg.biddingApplyLimit ?? null,
    leadsUnlockLimit: pkg.leadsUnlockLimit ?? null,
    featuredListing: pkg.featuredListing ?? false,
    boostProfile: pkg.boostProfile ?? false,
    prioritySupport: pkg.prioritySupport ?? false,
    analyticsAccess: pkg.analyticsAccess ?? false,
    advancedAnalytics: pkg.advancedAnalytics ?? false,
    invoiceTools: pkg.invoiceTools ?? false,
    paymentCollectionTools: pkg.paymentCollectionTools ?? false,
    whiteLabelAccess: pkg.whiteLabelAccess ?? false,
    brandingCustomization: pkg.brandingCustomization ?? false,
    automationTools: pkg.automationTools ?? false,
    apiAccess: pkg.apiAccess ?? false,
    webhookAccess: pkg.webhookAccess ?? false,
    verificationBadgeEligible: pkg.verificationBadgeEligible ?? false,
    dedicatedManager: pkg.dedicatedManager ?? false,
    commissionOverridePercent: pkg.commissionOverridePercent ?? null,
    isFree: billingType === "FREE" || pkg.isFree === true,
    isRecommended: pkg.isRecommended ?? false,
    allowRegistration: pkg.allowRegistration ?? true,
    paymentRequired: pkg.paymentRequired ?? billingType !== "FREE",
    autoRenewEnabled: pkg.autoRenewEnabled ?? billingType === "RECURRING",
    trialEnabled: pkg.trialEnabled ?? false,
    trialDays: pkg.trialDays ?? 0,
    setupFee: pkg.setupFee ?? 0,
    gracePeriodDays: pkg.gracePeriodDays ?? 0,
    showBadge: pkg.showBadge ?? true,
    showCta: pkg.showCta ?? true,
    priceLabel: formatMoney(currency, amount),
    billingLabel: billingLabelFor(billingType, billingInterval),
    featureBullets: pkg.featureBullets ?? [],
    compareHighlights: pkg.compareHighlights ?? pkg.featureBullets ?? [],
    features: [],
    isActive: pkg.isActive ?? true,
    isVisibleOnRegistration: pkg.isVisibleOnRegistration ?? true,
    sortOrder: pkg.sortOrder ?? 100,
    durationDays: pkg.durationDays ?? durationFor(billingInterval),
    statusLabel: pkg.statusLabel ?? pkg.shortSubtitle ?? "Package ready",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function defaultRegistrationPackages() {
  return DEFAULT_PACKAGES.map(mapDefaultPackage).sort((left, right) => left.sortOrder - right.sortOrder);
}

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function toNullableInt(value: unknown, fallback: number | null = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function toNullableMoney(value: unknown, fallback: number | null = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function normalizeBillingType(value: unknown, fallback: PackageBillingType): PackageBillingType {
  return value === "FREE" || value === "ONE_TIME_PAID" || value === "RECURRING" ? value : fallback;
}

function normalizeBillingInterval(value: unknown, fallback: PackageBillingInterval): PackageBillingInterval {
  return value === "MONTHLY" || value === "QUARTERLY" || value === "YEARLY" || value === "ONE_TIME" || value === "CUSTOM" ? value : fallback;
}

function normalizePackageType(value: unknown, audience: RegistrationPackageAudience): RegistrationPackageType {
  return value === "FREELANCER" || value === "AGENCY" || value === "BOTH" ? value : audience;
}

function audienceFromPackageType(value: RegistrationPackageType): RegistrationPackageAudience {
  return value === "AGENCY" ? "AGENCY" : "FREELANCER";
}

function formatMoney(currency: string, amount: number | null) {
  const safeAmount = amount ?? 0;
  if (currency.toUpperCase() === "INR") {
    return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(safeAmount)}`;
  }
  return `${currency.toUpperCase()} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(safeAmount)}`;
}

function billingLabelFor(type: PackageBillingType, interval: PackageBillingInterval) {
  if (type === "FREE") return "Get started";
  if (type === "ONE_TIME_PAID" || interval === "ONE_TIME") return "One-time payment";
  if (interval === "MONTHLY") return "Per month";
  if (interval === "QUARTERLY") return "Per quarter";
  if (interval === "YEARLY") return "Per year";
  return "Custom billing";
}

function durationFor(interval: PackageBillingInterval, fallback?: number) {
  if (fallback && fallback > 0) return fallback;
  if (interval === "MONTHLY") return 30;
  if (interval === "QUARTERLY") return 90;
  if (interval === "YEARLY") return 365;
  return 3650;
}

function mapFeatureValue(value: PackageWithFeatures["featureValues"][number]): RegistrationPackageFeature {
  const type = value.feature.featureType as PackageFeatureType;
  const numericValue = toNumber(value.numericValue);
  const rawValue = type === "BOOLEAN" ? value.booleanValue ?? false : type === "NUMBER" ? numericValue : value.textValue ?? null;
  const fallbackDisplay =
    value.shortDisplayText ||
    value.feature.shortDisplayText ||
    (type === "BOOLEAN" ? value.feature.featureLabel : rawValue === null ? value.feature.featureLabel : `${value.feature.featureLabel}: ${rawValue}`);

  return {
    id: value.id,
    featureId: value.featureId,
    featureKey: value.feature.featureKey,
    label: value.feature.featureLabel,
    type,
    category: value.feature.category,
    iconKey: value.feature.iconKey,
    sortOrder: value.feature.sortOrder,
    showInRegistrationCompare: value.feature.showInRegistrationCompare,
    showInSelectedSummary: value.feature.showInSelectedSummary,
    value: rawValue,
    shortDisplayText: fallbackDisplay,
  };
}

function mapPackage(pkg: PackageWithFeatures): RegistrationPackage {
  const features = pkg.featureValues.map(mapFeatureValue).sort((left, right) => left.sortOrder - right.sortOrder);
  const selectedFeatureBullets = features.filter((item) => item.showInSelectedSummary).map((item) => item.shortDisplayText);
  const compareHighlights = pkg.compareHighlights.length
    ? pkg.compareHighlights
    : features.filter((item) => item.showInRegistrationCompare).map((item) => item.shortDisplayText);
  const amount = toNumber(pkg.amount) ?? 0;
  const packageType = pkg.packageType as RegistrationPackageType;
  const rawBillingType = pkg.billingType as PackageBillingType;
  const rawBillingInterval = pkg.billingInterval as PackageBillingInterval;
  const isFree = pkg.isFree || pkg.paymentRequired === false || amount <= 0 || rawBillingType === "FREE";
  const billingType = isFree ? "FREE" : rawBillingType;
  const billingInterval = isFree ? "CUSTOM" : rawBillingInterval;

  return {
    id: pkg.id,
    slug: pkg.slug,
    name: pkg.name,
    audience: audienceFromPackageType(packageType),
    packageType,
    shortSubtitle: pkg.shortSubtitle ?? undefined,
    description: pkg.description ?? undefined,
    badgeText: pkg.badgeText ?? undefined,
    ctaLabel: pkg.ctaLabel ?? undefined,
    billingType,
    billingInterval,
    currency: pkg.currency,
    amount,
    priceMonthly: toNumber(pkg.priceMonthly),
    priceQuarterly: toNumber(pkg.priceQuarterly),
    priceYearly: toNumber(pkg.priceYearly),
    priceOneTime: toNumber(pkg.priceOneTime),
    serviceLimit: pkg.serviceLimit,
    activeProjectLimit: pkg.activeProjectLimit,
    portfolioItemLimit: pkg.portfolioItemLimit,
    teamMemberLimit: pkg.teamMemberLimit,
    staffAccountLimit: pkg.staffAccountLimit,
    clientLimit: pkg.clientLimit,
    editorFreelancerLimit: pkg.editorFreelancerLimit,
    storageLimitMb: pkg.storageLimitMb,
    maxUploadSizeMb: pkg.maxUploadSizeMb,
    chatAccess: pkg.chatAccess,
    clientChat: pkg.clientChat,
    teamChat: pkg.teamChat,
    whatsappIntegration: pkg.whatsappIntegration,
    aiToolsAccess: pkg.aiToolsAccess,
    aiCredits: pkg.aiCredits,
    proposalLimit: pkg.proposalLimit,
    biddingApplyLimit: pkg.biddingApplyLimit,
    leadsUnlockLimit: pkg.leadsUnlockLimit,
    featuredListing: pkg.featuredListing,
    boostProfile: pkg.boostProfile,
    prioritySupport: pkg.prioritySupport,
    analyticsAccess: pkg.analyticsAccess,
    advancedAnalytics: pkg.advancedAnalytics,
    invoiceTools: pkg.invoiceTools,
    paymentCollectionTools: pkg.paymentCollectionTools,
    whiteLabelAccess: pkg.whiteLabelAccess,
    brandingCustomization: pkg.brandingCustomization,
    automationTools: pkg.automationTools,
    apiAccess: pkg.apiAccess,
    webhookAccess: pkg.webhookAccess,
    verificationBadgeEligible: pkg.verificationBadgeEligible,
    dedicatedManager: pkg.dedicatedManager,
    commissionOverridePercent: toNumber(pkg.commissionOverridePercent),
    isFree,
    isRecommended: pkg.isRecommended,
    allowRegistration: pkg.allowRegistration,
    paymentRequired: isFree ? false : pkg.paymentRequired,
    autoRenewEnabled: isFree ? false : pkg.autoRenewEnabled,
    trialEnabled: pkg.trialEnabled,
    trialDays: pkg.trialDays,
    setupFee: toNumber(pkg.setupFee) ?? 0,
    gracePeriodDays: pkg.gracePeriodDays,
    showBadge: pkg.showBadge,
    showCta: pkg.showCta,
    priceLabel: formatMoney(pkg.currency, amount),
    billingLabel: billingLabelFor(billingType, billingInterval),
    featureBullets: pkg.selectedSummaryBullets.length ? pkg.selectedSummaryBullets : selectedFeatureBullets,
    compareHighlights,
    features,
    isActive: pkg.isActive,
    isVisibleOnRegistration: pkg.isVisibleOnRegistration,
    sortOrder: pkg.sortOrder,
    durationDays: durationFor(billingInterval, pkg.durationDays),
    statusLabel: pkg.shortSubtitle ?? pkg.badgeText ?? "Package ready",
    createdAt: pkg.createdAt.toISOString(),
    updatedAt: pkg.updatedAt.toISOString(),
  };
}

async function ensureFeature(input: RegistrationPackageFeatureInput) {
  return prisma.packageFeature.upsert({
    where: { featureKey: input.featureKey },
    create: {
      featureKey: input.featureKey,
      featureLabel: input.featureLabel,
      featureType: input.featureType,
      category: input.category ?? null,
      showInRegistrationCompare: input.showInRegistrationCompare ?? false,
      showInSelectedSummary: input.showInSelectedSummary ?? false,
      shortDisplayText: input.shortDisplayText ?? null,
      iconKey: input.iconKey ?? null,
      sortOrder: input.sortOrder ?? 100,
      isActive: true,
    },
    update: {
      featureLabel: input.featureLabel,
      featureType: input.featureType,
      category: input.category ?? null,
      showInRegistrationCompare: input.showInRegistrationCompare ?? false,
      showInSelectedSummary: input.showInSelectedSummary ?? false,
      shortDisplayText: input.shortDisplayText ?? null,
      iconKey: input.iconKey ?? null,
      sortOrder: input.sortOrder ?? 100,
      isActive: true,
    },
  });
}

async function upsertFeatureValues(packageId: string, inputs: RegistrationPackageFeatureInput[]) {
  for (const input of inputs) {
    const feature = await ensureFeature(input);
    await prisma.packageFeatureValue.upsert({
      where: { packageId_featureId: { packageId, featureId: feature.id } },
      create: {
        packageId,
        featureId: feature.id,
        booleanValue: input.featureType === "BOOLEAN" ? input.booleanValue ?? true : null,
        numericValue: input.featureType === "NUMBER" ? input.numericValue ?? null : null,
        textValue: input.featureType === "TEXT" ? input.textValue ?? null : null,
        shortDisplayText: input.valueShortDisplayText ?? input.shortDisplayText ?? null,
      },
      update: {
        booleanValue: input.featureType === "BOOLEAN" ? input.booleanValue ?? true : null,
        numericValue: input.featureType === "NUMBER" ? input.numericValue ?? null : null,
        textValue: input.featureType === "TEXT" ? input.textValue ?? null : null,
        shortDisplayText: input.valueShortDisplayText ?? input.shortDisplayText ?? null,
      },
    });
  }
}

let bootstrapPromise: Promise<void> | null = null;

export async function ensureBillingPackagesBootstrapped() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const existingCount = await prisma.package.count();
      const packagesToSave =
        existingCount === 0
          ? DEFAULT_PACKAGES
          : DEFAULT_PACKAGES.filter((pkg) => pkg.id === "pkg-agency-freemium" || pkg.id === "pkg-agency-premium");

      for (const pkg of packagesToSave) {
        const existing = await prisma.package.findUnique({ where: { id: pkg.id } });
        const saved = await saveRegistrationPackage({
          ...pkg,
          ...(pkg.id === "pkg-agency-freemium" || pkg.id === "pkg-agency-premium"
            ? { isActive: true, isVisibleOnRegistration: true, allowRegistration: true }
            : {}),
          ...(pkg.id === "pkg-agency-freemium" ? { editorFreelancerLimit: 2 } : {}),
          featureInputs: DEFAULT_FEATURES.map((feature) => ({
            ...feature,
            shortDisplayText:
              pkg.featureBullets?.find((item) => item.toLowerCase().includes(feature.featureLabel.split(" ")[0].toLowerCase())) ??
              feature.shortDisplayText,
            valueShortDisplayText:
              pkg.featureBullets?.find((item) => item.toLowerCase().includes(feature.featureLabel.split(" ")[0].toLowerCase())) ??
              feature.shortDisplayText,
          })),
        });

        await prisma.packageChangeHistory.create({
          data: {
            packageId: saved.id,
            changeType: existing ? "required-registration-repair" : "bootstrap",
            payload: {
              source: "default-registration-packages",
              required: pkg.id === "pkg-agency-freemium" || pkg.id === "pkg-agency-premium",
            },
          },
        });
      }
    })();
  }
  return bootstrapPromise;
}

export async function listRegistrationPackages() {
  try {
    await ensureBillingPackagesBootstrapped();
    const packages = await prisma.package.findMany({
      include: { featureValues: { include: { feature: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return packages.map(mapPackage);
  } catch (error) {
    console.error("Billing package store is unavailable; using registration fallback packages.", error);
    return defaultRegistrationPackages();
  }
}

export async function listActiveRegistrationPackages() {
  try {
    await ensureBillingPackagesBootstrapped();
    const packages = await prisma.package.findMany({
      where: { isActive: true, isVisibleOnRegistration: true, allowRegistration: true },
      include: { featureValues: { include: { feature: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return packages.map(mapPackage);
  } catch (error) {
    console.error("Billing package store is unavailable; using active registration fallback packages.", error);
    return defaultRegistrationPackages().filter((item) => item.isActive && item.isVisibleOnRegistration !== false && item.allowRegistration !== false);
  }
}

export async function findRegistrationPackage(packageId: string | null | undefined) {
  if (!packageId?.trim()) return null;
  try {
    await ensureBillingPackagesBootstrapped();
    const pkg = await prisma.package.findFirst({
      where: { OR: [{ id: packageId.trim() }, { slug: packageId.trim() }] },
      include: { featureValues: { include: { feature: true } } },
    });
    return pkg ? mapPackage(pkg) : null;
  } catch (error) {
    console.error("Billing package store is unavailable; finding fallback package.", error);
    return defaultRegistrationPackages().find((item) => item.id === packageId.trim() || item.slug === packageId.trim()) ?? null;
  }
}

export async function saveRegistrationPackage(input: SavePackageInput) {
  const existing = input.id?.trim() ? await prisma.package.findUnique({ where: { id: input.id.trim() } }) : null;
  const name = input.name?.trim() || existing?.name || "New package";
  const audience = input.audience === "AGENCY" ? "AGENCY" : "FREELANCER";
  const packageType = normalizePackageType(input.packageType, audience);
  const billingType = normalizeBillingType(input.billingType, input.isFree ? "FREE" : existing?.billingType ?? "RECURRING");
  const billingInterval = normalizeBillingInterval(
    input.billingInterval,
    billingType === "ONE_TIME_PAID" ? "ONE_TIME" : billingType === "FREE" ? "CUSTOM" : existing?.billingInterval ?? "MONTHLY",
  );
  const amount = Number(input.amount ?? existing?.amount ?? 0);
  const currency = input.currency?.trim().toUpperCase() || existing?.currency || "INR";
  const selectedSummaryBullets = input.featureBullets?.map((item) => item.trim()).filter(Boolean) ?? existing?.selectedSummaryBullets ?? [];
  const compareHighlights = input.compareHighlights?.map((item) => item.trim()).filter(Boolean) ?? existing?.compareHighlights ?? [];
  const slugBase = input.slug?.trim() || existing?.slug || slugify(name);
  const controlData = {
    serviceLimit: toNullableInt(input.serviceLimit, existing?.serviceLimit ?? null),
    activeProjectLimit: toNullableInt(input.activeProjectLimit, existing?.activeProjectLimit ?? null),
    portfolioItemLimit: toNullableInt(input.portfolioItemLimit, existing?.portfolioItemLimit ?? null),
    teamMemberLimit: toNullableInt(input.teamMemberLimit, existing?.teamMemberLimit ?? null),
    staffAccountLimit: toNullableInt(input.staffAccountLimit, existing?.staffAccountLimit ?? null),
    clientLimit: toNullableInt(input.clientLimit, existing?.clientLimit ?? null),
    editorFreelancerLimit: toNullableInt(input.editorFreelancerLimit, existing?.editorFreelancerLimit ?? null),
    storageLimitMb: toNullableInt(input.storageLimitMb, existing?.storageLimitMb ?? null),
    maxUploadSizeMb: toNullableInt(input.maxUploadSizeMb, existing?.maxUploadSizeMb ?? null),
    chatAccess: toBoolean(input.chatAccess, existing?.chatAccess ?? false),
    clientChat: toBoolean(input.clientChat, existing?.clientChat ?? false),
    teamChat: toBoolean(input.teamChat, existing?.teamChat ?? false),
    whatsappIntegration: toBoolean(input.whatsappIntegration, existing?.whatsappIntegration ?? false),
    aiToolsAccess: toBoolean(input.aiToolsAccess, existing?.aiToolsAccess ?? false),
    aiCredits: toNullableInt(input.aiCredits, existing?.aiCredits ?? null),
    proposalLimit: toNullableInt(input.proposalLimit, existing?.proposalLimit ?? null),
    biddingApplyLimit: toNullableInt(input.biddingApplyLimit, existing?.biddingApplyLimit ?? null),
    leadsUnlockLimit: toNullableInt(input.leadsUnlockLimit, existing?.leadsUnlockLimit ?? null),
    featuredListing: toBoolean(input.featuredListing, existing?.featuredListing ?? false),
    boostProfile: toBoolean(input.boostProfile, existing?.boostProfile ?? false),
    prioritySupport: toBoolean(input.prioritySupport, existing?.prioritySupport ?? false),
    analyticsAccess: toBoolean(input.analyticsAccess, existing?.analyticsAccess ?? false),
    advancedAnalytics: toBoolean(input.advancedAnalytics, existing?.advancedAnalytics ?? false),
    invoiceTools: toBoolean(input.invoiceTools, existing?.invoiceTools ?? false),
    paymentCollectionTools: toBoolean(input.paymentCollectionTools, existing?.paymentCollectionTools ?? false),
    whiteLabelAccess: toBoolean(input.whiteLabelAccess, existing?.whiteLabelAccess ?? false),
    brandingCustomization: toBoolean(input.brandingCustomization, existing?.brandingCustomization ?? false),
    automationTools: toBoolean(input.automationTools, existing?.automationTools ?? false),
    apiAccess: toBoolean(input.apiAccess, existing?.apiAccess ?? false),
    webhookAccess: toBoolean(input.webhookAccess, existing?.webhookAccess ?? false),
    verificationBadgeEligible: toBoolean(input.verificationBadgeEligible, existing?.verificationBadgeEligible ?? false),
    dedicatedManager: toBoolean(input.dedicatedManager, existing?.dedicatedManager ?? false),
    commissionOverridePercent: toNullableMoney(input.commissionOverridePercent, toNumber(existing?.commissionOverridePercent) ?? null),
  };

  const saved = await prisma.package.upsert({
    where: { id: existing?.id ?? input.id?.trim() ?? `missing-${Date.now()}` },
    create: {
      id: input.id?.trim() || undefined,
      name,
      slug: slugBase,
      packageType,
      shortSubtitle: input.shortSubtitle?.trim() || input.statusLabel?.trim() || null,
      description: input.description?.trim() || null,
      badgeText: input.badgeText?.trim() || null,
      ctaLabel: input.ctaLabel?.trim() || null,
      billingType,
      billingInterval,
      currency,
      amount: Number.isFinite(amount) ? amount : 0,
      priceMonthly: input.priceMonthly ?? null,
      priceQuarterly: input.priceQuarterly ?? null,
      priceYearly: input.priceYearly ?? null,
      priceOneTime: input.priceOneTime ?? null,
      isFree: billingType === "FREE" || input.isFree === true,
      isActive: input.isActive ?? true,
      isVisibleOnRegistration: input.isVisibleOnRegistration ?? true,
      isRecommended: input.isRecommended ?? false,
      allowRegistration: input.allowRegistration ?? true,
      paymentRequired: input.paymentRequired ?? billingType !== "FREE",
      autoRenewEnabled: input.autoRenewEnabled ?? billingType === "RECURRING",
      trialEnabled: input.trialEnabled ?? false,
      trialDays: input.trialDays ?? 0,
      setupFee: input.setupFee ?? 0,
      gracePeriodDays: input.gracePeriodDays ?? 0,
      durationDays: input.durationDays ?? durationFor(billingInterval),
      sortOrder: input.sortOrder ?? 100,
      selectedSummaryBullets,
      compareHighlights,
      showBadge: input.showBadge ?? true,
      showCta: input.showCta ?? true,
      featureOrder: [],
      upgradePathIds: [],
      downgradePathIds: [],
      ...controlData,
    },
    update: {
      name,
      slug: slugBase,
      packageType,
      shortSubtitle: input.shortSubtitle?.trim() || input.statusLabel?.trim() || null,
      description: input.description?.trim() || null,
      badgeText: input.badgeText?.trim() || null,
      ctaLabel: input.ctaLabel?.trim() || null,
      billingType,
      billingInterval,
      currency,
      amount: Number.isFinite(amount) ? amount : 0,
      priceMonthly: input.priceMonthly ?? null,
      priceQuarterly: input.priceQuarterly ?? null,
      priceYearly: input.priceYearly ?? null,
      priceOneTime: input.priceOneTime ?? null,
      isFree: billingType === "FREE" || input.isFree === true,
      isActive: input.isActive ?? existing?.isActive ?? true,
      isVisibleOnRegistration: input.isVisibleOnRegistration ?? existing?.isVisibleOnRegistration ?? true,
      isRecommended: input.isRecommended ?? existing?.isRecommended ?? false,
      allowRegistration: input.allowRegistration ?? existing?.allowRegistration ?? true,
      paymentRequired: input.paymentRequired ?? billingType !== "FREE",
      autoRenewEnabled: input.autoRenewEnabled ?? billingType === "RECURRING",
      trialEnabled: input.trialEnabled ?? existing?.trialEnabled ?? false,
      trialDays: input.trialDays ?? existing?.trialDays ?? 0,
      setupFee: input.setupFee ?? existing?.setupFee ?? 0,
      gracePeriodDays: input.gracePeriodDays ?? existing?.gracePeriodDays ?? 0,
      durationDays: input.durationDays ?? existing?.durationDays ?? durationFor(billingInterval),
      sortOrder: input.sortOrder ?? existing?.sortOrder ?? 100,
      selectedSummaryBullets,
      compareHighlights,
      showBadge: input.showBadge ?? existing?.showBadge ?? true,
      showCta: input.showCta ?? existing?.showCta ?? true,
      ...controlData,
    },
    include: { featureValues: { include: { feature: true } } },
  });

  const featureInputs =
    input.featureInputs && input.featureInputs.length
      ? input.featureInputs
      : selectedSummaryBullets.map((item, index) => ({
          featureKey: `${slugBase}-feature-${index + 1}`,
          featureLabel: item,
          featureType: "TEXT" as const,
          category: "Summary",
          showInRegistrationCompare: true,
          showInSelectedSummary: true,
          textValue: item,
          shortDisplayText: item,
          valueShortDisplayText: item,
          sortOrder: index + 1,
        }));

  await upsertFeatureValues(saved.id, featureInputs);
  const refreshed = await prisma.package.findUniqueOrThrow({
    where: { id: saved.id },
    include: { featureValues: { include: { feature: true } } },
  });

  return mapPackage(refreshed);
}

export async function ensurePersistedRegistrationPackage(input: RegistrationPackage) {
  const existing = await prisma.package.findFirst({
    where: {
      OR: [
        { id: input.id },
        ...(input.slug?.trim() ? [{ slug: input.slug.trim() }] : []),
      ],
    },
    include: { featureValues: { include: { feature: true } } },
  });

  if (existing) {
    return mapPackage(existing);
  }

  return saveRegistrationPackage({
    id: input.id,
    slug: input.slug,
    name: input.name,
    audience: input.audience,
    packageType: input.packageType,
    shortSubtitle: input.shortSubtitle,
    description: input.description,
    badgeText: input.badgeText,
    ctaLabel: input.ctaLabel,
    billingType: input.billingType,
    billingInterval: input.billingInterval,
    currency: input.currency,
    amount: input.amount,
    priceMonthly: input.priceMonthly,
    priceQuarterly: input.priceQuarterly,
    priceYearly: input.priceYearly,
    priceOneTime: input.priceOneTime,
    serviceLimit: input.serviceLimit,
    activeProjectLimit: input.activeProjectLimit,
    portfolioItemLimit: input.portfolioItemLimit,
    teamMemberLimit: input.teamMemberLimit,
    staffAccountLimit: input.staffAccountLimit,
    clientLimit: input.clientLimit,
    editorFreelancerLimit: input.editorFreelancerLimit,
    storageLimitMb: input.storageLimitMb,
    maxUploadSizeMb: input.maxUploadSizeMb,
    chatAccess: input.chatAccess,
    clientChat: input.clientChat,
    teamChat: input.teamChat,
    whatsappIntegration: input.whatsappIntegration,
    aiToolsAccess: input.aiToolsAccess,
    aiCredits: input.aiCredits,
    proposalLimit: input.proposalLimit,
    biddingApplyLimit: input.biddingApplyLimit,
    leadsUnlockLimit: input.leadsUnlockLimit,
    featuredListing: input.featuredListing,
    boostProfile: input.boostProfile,
    prioritySupport: input.prioritySupport,
    analyticsAccess: input.analyticsAccess,
    advancedAnalytics: input.advancedAnalytics,
    invoiceTools: input.invoiceTools,
    paymentCollectionTools: input.paymentCollectionTools,
    whiteLabelAccess: input.whiteLabelAccess,
    brandingCustomization: input.brandingCustomization,
    automationTools: input.automationTools,
    apiAccess: input.apiAccess,
    webhookAccess: input.webhookAccess,
    verificationBadgeEligible: input.verificationBadgeEligible,
    dedicatedManager: input.dedicatedManager,
    commissionOverridePercent: input.commissionOverridePercent,
    isFree: input.isFree,
    isRecommended: input.isRecommended,
    allowRegistration: input.allowRegistration,
    paymentRequired: input.paymentRequired,
    autoRenewEnabled: input.autoRenewEnabled,
    trialEnabled: input.trialEnabled,
    trialDays: input.trialDays,
    setupFee: input.setupFee,
    gracePeriodDays: input.gracePeriodDays,
    showBadge: input.showBadge,
    showCta: input.showCta,
    featureBullets: input.featureBullets,
    compareHighlights: input.compareHighlights,
    isActive: input.isActive,
    isVisibleOnRegistration: input.isVisibleOnRegistration,
    sortOrder: input.sortOrder,
    durationDays: input.durationDays,
    statusLabel: input.statusLabel,
    featureInputs: input.features?.map((feature) => ({
      featureKey: feature.featureKey,
      featureLabel: feature.label,
      featureType: feature.type,
      category: feature.category,
      showInRegistrationCompare: feature.showInRegistrationCompare,
      showInSelectedSummary: feature.showInSelectedSummary,
      shortDisplayText: feature.shortDisplayText,
      iconKey: feature.iconKey,
      sortOrder: feature.sortOrder,
      booleanValue: typeof feature.value === "boolean" ? feature.value : null,
      numericValue: typeof feature.value === "number" ? feature.value : null,
      textValue: typeof feature.value === "string" ? feature.value : null,
      valueShortDisplayText: feature.shortDisplayText,
    })),
  });
}
