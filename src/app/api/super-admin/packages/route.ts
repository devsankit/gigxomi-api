import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listRegistrationPackages, saveRegistrationPackage } from "@/lib/gigxomi/public-growth-store";
import type { RegistrationPackage, RegistrationPackageAudience } from "@/lib/gigxomi/public-growth-types";

type PackageRequestBody = Partial<RegistrationPackage> & {
  featureBullets?: unknown;
  audience?: unknown;
};

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.round(parsed);
}

function readAudience(value: unknown): RegistrationPackageAudience | null {
  return value === "AGENCY" || value === "FREELANCER" ? value : null;
}

function readFeatureBullets(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => readTrimmedString(item)).filter(Boolean);
}

function readStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => readTrimmedString(item)).filter(Boolean);
}

function readMoney(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export async function GET() {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const packages = await listRegistrationPackages();
  return NextResponse.json({ ok: true, packages });
}

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as PackageRequestBody | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Package payload is required." }, { status: 400 });
  }

  const name = readTrimmedString(body.name);
  const audience = readAudience(body.audience);
  const priceLabel = readTrimmedString(body.priceLabel);
  const billingLabel = readTrimmedString(body.billingLabel);
  const statusLabel = readTrimmedString(body.statusLabel);
  const featureBullets = readFeatureBullets(body.featureBullets);
  const compareHighlights = readStringList((body as { compareHighlights?: unknown }).compareHighlights);
  const sortOrder = readPositiveNumber(body.sortOrder, 1);
  const durationDays = readPositiveNumber(body.durationDays, 30);
  const billingType = readTrimmedString((body as { billingType?: unknown }).billingType);
  const billingInterval = readTrimmedString((body as { billingInterval?: unknown }).billingInterval);
  const amount = readMoney((body as { amount?: unknown }).amount);

  if (!name) {
    return NextResponse.json({ ok: false, error: "Package name is required." }, { status: 400 });
  }

  if (!audience) {
    return NextResponse.json({ ok: false, error: "Package audience must be freelancer or agency." }, { status: 400 });
  }

  if (!priceLabel || !billingLabel || !statusLabel) {
    return NextResponse.json({ ok: false, error: "Price, billing label, and status label are required." }, { status: 400 });
  }

  if (!featureBullets.length) {
    return NextResponse.json({ ok: false, error: "Add at least one feature bullet for the package." }, { status: 400 });
  }

  const savedPackage = await saveRegistrationPackage({
    id: readTrimmedString(body.id) || undefined,
    name,
    audience,
    priceLabel,
    billingLabel,
    statusLabel,
    featureBullets,
    compareHighlights,
    sortOrder,
    durationDays,
    isActive: typeof body.isActive === "boolean" ? body.isActive : true,
    shortSubtitle: readTrimmedString((body as { shortSubtitle?: unknown }).shortSubtitle) || statusLabel,
    description: readTrimmedString((body as { description?: unknown }).description),
    badgeText: readTrimmedString((body as { badgeText?: unknown }).badgeText),
    ctaLabel: readTrimmedString((body as { ctaLabel?: unknown }).ctaLabel),
    billingType: billingType === "FREE" || billingType === "ONE_TIME_PAID" || billingType === "RECURRING" ? billingType : amount > 0 ? "RECURRING" : "FREE",
    billingInterval:
      billingInterval === "MONTHLY" || billingInterval === "QUARTERLY" || billingInterval === "YEARLY" || billingInterval === "ONE_TIME" || billingInterval === "CUSTOM"
        ? billingInterval
        : amount > 0
          ? "MONTHLY"
          : "CUSTOM",
    currency: readTrimmedString((body as { currency?: unknown }).currency) || "INR",
    amount,
    priceMonthly: readMoney((body as { priceMonthly?: unknown }).priceMonthly, amount),
    priceQuarterly: readMoney((body as { priceQuarterly?: unknown }).priceQuarterly, 0),
    priceYearly: readMoney((body as { priceYearly?: unknown }).priceYearly, 0),
    priceOneTime: readMoney((body as { priceOneTime?: unknown }).priceOneTime, 0),
    isFree: amount <= 0,
    paymentRequired: amount > 0,
    autoRenewEnabled: billingType === "RECURRING",
    isRecommended: typeof (body as { isRecommended?: unknown }).isRecommended === "boolean" ? (body as { isRecommended?: boolean }).isRecommended : false,
    allowRegistration: typeof (body as { allowRegistration?: unknown }).allowRegistration === "boolean" ? (body as { allowRegistration?: boolean }).allowRegistration : true,
    isVisibleOnRegistration: typeof (body as { isVisibleOnRegistration?: unknown }).isVisibleOnRegistration === "boolean" ? (body as { isVisibleOnRegistration?: boolean }).isVisibleOnRegistration : true,
    trialEnabled: typeof (body as { trialEnabled?: unknown }).trialEnabled === "boolean" ? (body as { trialEnabled?: boolean }).trialEnabled : false,
    trialDays: readPositiveNumber((body as { trialDays?: unknown }).trialDays, 0),
    setupFee: readMoney((body as { setupFee?: unknown }).setupFee, 0),
    gracePeriodDays: readPositiveNumber((body as { gracePeriodDays?: unknown }).gracePeriodDays, 0),
    serviceLimit: readNullableNumber((body as { serviceLimit?: unknown }).serviceLimit),
    activeProjectLimit: readNullableNumber((body as { activeProjectLimit?: unknown }).activeProjectLimit),
    portfolioItemLimit: readNullableNumber((body as { portfolioItemLimit?: unknown }).portfolioItemLimit),
    teamMemberLimit: readNullableNumber((body as { teamMemberLimit?: unknown }).teamMemberLimit),
    staffAccountLimit: readNullableNumber((body as { staffAccountLimit?: unknown }).staffAccountLimit),
    clientLimit: readNullableNumber((body as { clientLimit?: unknown }).clientLimit),
    editorFreelancerLimit: readNullableNumber((body as { editorFreelancerLimit?: unknown }).editorFreelancerLimit),
    storageLimitMb: readNullableNumber((body as { storageLimitMb?: unknown }).storageLimitMb),
    maxUploadSizeMb: readNullableNumber((body as { maxUploadSizeMb?: unknown }).maxUploadSizeMb),
    chatAccess: readBoolean((body as { chatAccess?: unknown }).chatAccess),
    clientChat: readBoolean((body as { clientChat?: unknown }).clientChat),
    teamChat: readBoolean((body as { teamChat?: unknown }).teamChat),
    whatsappIntegration: readBoolean((body as { whatsappIntegration?: unknown }).whatsappIntegration),
    aiToolsAccess: readBoolean((body as { aiToolsAccess?: unknown }).aiToolsAccess),
    aiCredits: readNullableNumber((body as { aiCredits?: unknown }).aiCredits),
    proposalLimit: readNullableNumber((body as { proposalLimit?: unknown }).proposalLimit),
    biddingApplyLimit: readNullableNumber((body as { biddingApplyLimit?: unknown }).biddingApplyLimit),
    leadsUnlockLimit: readNullableNumber((body as { leadsUnlockLimit?: unknown }).leadsUnlockLimit),
    featuredListing: readBoolean((body as { featuredListing?: unknown }).featuredListing),
    boostProfile: readBoolean((body as { boostProfile?: unknown }).boostProfile),
    prioritySupport: readBoolean((body as { prioritySupport?: unknown }).prioritySupport),
    analyticsAccess: readBoolean((body as { analyticsAccess?: unknown }).analyticsAccess),
    advancedAnalytics: readBoolean((body as { advancedAnalytics?: unknown }).advancedAnalytics),
    invoiceTools: readBoolean((body as { invoiceTools?: unknown }).invoiceTools),
    paymentCollectionTools: readBoolean((body as { paymentCollectionTools?: unknown }).paymentCollectionTools),
    whiteLabelAccess: readBoolean((body as { whiteLabelAccess?: unknown }).whiteLabelAccess),
    brandingCustomization: readBoolean((body as { brandingCustomization?: unknown }).brandingCustomization),
    automationTools: readBoolean((body as { automationTools?: unknown }).automationTools),
    apiAccess: readBoolean((body as { apiAccess?: unknown }).apiAccess),
    webhookAccess: readBoolean((body as { webhookAccess?: unknown }).webhookAccess),
    verificationBadgeEligible: readBoolean((body as { verificationBadgeEligible?: unknown }).verificationBadgeEligible),
    dedicatedManager: readBoolean((body as { dedicatedManager?: unknown }).dedicatedManager),
    commissionOverridePercent: readNullableNumber((body as { commissionOverridePercent?: unknown }).commissionOverridePercent),
  });

  const packages = await listRegistrationPackages();
  return NextResponse.json({
    ok: true,
    package: savedPackage,
    packages,
  });
}
