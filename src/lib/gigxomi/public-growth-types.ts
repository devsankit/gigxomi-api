export type RegistrationPackageAudience = "FREELANCER" | "AGENCY";
export type RegistrationPackageStatus = "ACTIVE" | "PAUSED";
export type RegistrationPackageType = RegistrationPackageAudience | "BOTH";
export type PackageBillingType = "FREE" | "ONE_TIME_PAID" | "RECURRING";
export type PackageBillingInterval = "MONTHLY" | "QUARTERLY" | "YEARLY" | "ONE_TIME" | "CUSTOM";
export type PackageFeatureType = "BOOLEAN" | "NUMBER" | "TEXT";

export type RegistrationPackageFeature = {
  id: string;
  featureId: string;
  featureKey: string;
  label: string;
  type: PackageFeatureType;
  category: string | null;
  iconKey: string | null;
  sortOrder: number;
  showInRegistrationCompare: boolean;
  showInSelectedSummary: boolean;
  value: boolean | number | string | null;
  shortDisplayText: string;
};

export type RegistrationPackage = {
  id: string;
  name: string;
  audience: RegistrationPackageAudience;
  packageType?: RegistrationPackageType;
  slug?: string;
  shortSubtitle?: string;
  description?: string;
  badgeText?: string;
  ctaLabel?: string;
  billingType?: PackageBillingType;
  billingInterval?: PackageBillingInterval;
  currency?: string;
  amount?: number;
  priceMonthly?: number | null;
  priceMonthlyInr?: number | null;
  priceQuarterly?: number | null;
  priceYearly?: number | null;
  priceYearlyInr?: number | null;
  pricePerAdditionalSeatInr?: number | null;
  priceOneTime?: number | null;
  serviceLimit?: number | null;
  activeProjectLimit?: number | null;
  portfolioItemLimit?: number | null;
  teamMemberLimit?: number | null;
  staffAccountLimit?: number | null;
  clientLimit?: number | null;
  editorFreelancerLimit?: number | null;
  storageLimitMb?: number | null;
  maxUploadSizeMb?: number | null;
  chatAccess?: boolean;
  clientChat?: boolean;
  teamChat?: boolean;
  whatsappIntegration?: boolean;
  aiToolsAccess?: boolean;
  aiCredits?: number | null;
  proposalLimit?: number | null;
  biddingApplyLimit?: number | null;
  leadsUnlockLimit?: number | null;
  featuredListing?: boolean;
  boostProfile?: boolean;
  prioritySupport?: boolean;
  analyticsAccess?: boolean;
  advancedAnalytics?: boolean;
  invoiceTools?: boolean;
  paymentCollectionTools?: boolean;
  whiteLabelAccess?: boolean;
  brandingCustomization?: boolean;
  automationTools?: boolean;
  apiAccess?: boolean;
  webhookAccess?: boolean;
  verificationBadgeEligible?: boolean;
  dedicatedManager?: boolean;
  commissionOverridePercent?: number | null;
  isFree?: boolean;
  isRecommended?: boolean;
  allowRegistration?: boolean;
  paymentRequired?: boolean;
  autoRenewEnabled?: boolean;
  trialEnabled?: boolean;
  trialDays?: number;
  setupFee?: number;
  gracePeriodDays?: number;
  showBadge?: boolean;
  showCta?: boolean;
  priceLabel: string;
  billingLabel: string;
  featureBullets: string[];
  compareHighlights?: string[];
  features?: RegistrationPackageFeature[];
  isActive: boolean;
  isVisibleOnRegistration?: boolean;
  sortOrder: number;
  durationDays: number;
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type RegistrationPackageFeatureInput = {
  featureKey: string;
  featureLabel: string;
  featureType: PackageFeatureType;
  category?: string | null;
  showInRegistrationCompare?: boolean;
  showInSelectedSummary?: boolean;
  shortDisplayText?: string | null;
  iconKey?: string | null;
  sortOrder?: number;
  booleanValue?: boolean | null;
  numericValue?: number | null;
  textValue?: string | null;
  valueShortDisplayText?: string | null;
};

export type MarketingIntegrationSettings = {
  ga4MeasurementId: string;
  gtmContainerId: string;
  searchConsoleSiteUrl: string;
  searchConsoleVerification: string;
  metaPixelId: string;
  pixelEndpoint: string;
  updatedAt: string | null;
};

export type LandingPageCampaignKey = "freelancers" | "agency-growth";

export type LandingPageCampaignSettings = {
  pageKey: LandingPageCampaignKey;
  videoUrl: string;
  videoTitle: string;
  countdownEnabled: boolean;
  countdownTargetIso: string;
  countdownLabel: string;
  urgencyText: string;
  stickyCtaLabel: string;
  updatedAt: string | null;
};

export type MarketingEventBlueprint = {
  event: string;
  note: string;
};

export type MarketingDebugEvent = {
  id: string;
  event: string;
  path: string | null;
  url: string | null;
  referrer: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PromptSearchDemandSuggestion = {
  term: string;
  category: string | null;
  count: number;
  noResultCount: number;
  latestResultCount: number;
  lastSeenAt: string;
};
