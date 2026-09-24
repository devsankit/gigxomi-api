import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  findRegistrationPackage as findBillingRegistrationPackage,
  listActiveRegistrationPackages as listActiveBillingRegistrationPackages,
  listRegistrationPackages as listBillingRegistrationPackages,
  saveRegistrationPackage as saveBillingRegistrationPackage,
} from "@/lib/billing/package-service";
import { selectLaunchRegistrationPackages } from "@/lib/billing/launch-registration-packages";
import type {
  LandingPageCampaignKey,
  LandingPageCampaignSettings,
  MarketingDebugEvent,
  MarketingEventBlueprint,
  MarketingIntegrationSettings,
  PromptSearchDemandSuggestion,
  RegistrationPackage,
} from "@/lib/gigxomi/public-growth-types";

type PublicGrowthSnapshot = {
  packages: RegistrationPackage[];
  marketing: MarketingIntegrationSettings;
  landingPages: Record<LandingPageCampaignKey, LandingPageCampaignSettings>;
  events: MarketingDebugEvent[];
};

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "public-growth-store.json");

function nowIso() {
  return new Date().toISOString();
}

function normalizePromptSearchTerm(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s+#.-]/gu, "")
    .slice(0, 80);
}

function buildDefaultPackages(): RegistrationPackage[] {
  const createdAt = nowIso();
  return [
    {
      id: "pkg-freelancer-starter",
      name: "Freelancer Starter",
      audience: "FREELANCER",
      priceLabel: "₹0",
      billingLabel: "Free forever",
      featureBullets: ["Create your profile", "Publish services", "Receive WhatsApp-first leads"],
      isActive: true,
      sortOrder: 1,
      durationDays: 3650,
      statusLabel: "Best for individual editors",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "pkg-freelancer-pro",
      name: "Freelancer",
      audience: "FREELANCER",
      priceLabel: "₹0",
      billingLabel: "Free forever",
      featureBullets: ["Public portfolio", "Service marketplace", "Agency opportunities"],
      isActive: true,
      sortOrder: 2,
      durationDays: 3650,
      statusLabel: "No subscription fee",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "pkg-agency-launch",
      name: "Agency",
      audience: "AGENCY",
      priceLabel: "₹12,000",
      billingLabel: "Per year",
      featureBullets: ["Lead CRM and clients", "Editor Team management", "Finance and analytics"],
      isActive: true,
      sortOrder: 3,
      durationDays: 365,
      statusLabel: "Complete annual agency workspace",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "pkg-agency-scale",
      name: "Agency Scale",
      audience: "AGENCY",
      priceLabel: "INR 11,999",
      billingLabel: "Per quarter",
      featureBullets: ["Larger team access", "Marketing integrations", "Priority support"],
      isActive: true,
      sortOrder: 4,
      durationDays: 90,
      statusLabel: "For growing teams",
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function buildDefaultMarketingSettings(): MarketingIntegrationSettings {
  return {
    ga4MeasurementId: "",
    gtmContainerId: "",
    searchConsoleSiteUrl: "https://www.gigxomi.com",
    searchConsoleVerification: "",
    metaPixelId: "",
    pixelEndpoint: "",
    updatedAt: null,
  };
}

function buildDefaultLandingPageSettings(): Record<LandingPageCampaignKey, LandingPageCampaignSettings> {
  return {
    freelancers: {
      pageKey: "freelancers",
      videoUrl: "",
      videoTitle: "Watch how Gigxomi helps editors get found",
      countdownEnabled: false,
      countdownTargetIso: "",
      countdownLabel: "Next freelancer onboarding starts in",
      urgencyText: "Create your freelancer profile before the next onboarding window.",
      stickyCtaLabel: "Start Free as Freelancer",
      updatedAt: null,
    },
    "agency-growth": {
      pageKey: "agency-growth",
      videoUrl: "",
      videoTitle: "Watch the agency growth workshop preview",
      countdownEnabled: false,
      countdownTargetIso: "",
      countdownLabel: "Product and business workshop starts in",
      urgencyText: "Reserve your seat for the next Gigxomi product exploration and business workshop.",
      stickyCtaLabel: "Know More",
      updatedAt: null,
    },
  };
}

function normalizeLandingPageSettings(input: unknown): Record<LandingPageCampaignKey, LandingPageCampaignSettings> {
  const defaults = buildDefaultLandingPageSettings();
  const source = input && typeof input === "object" ? (input as Partial<Record<LandingPageCampaignKey, Partial<LandingPageCampaignSettings>>>) : {};

  return {
    freelancers: {
      ...defaults.freelancers,
      ...source.freelancers,
      pageKey: "freelancers",
    },
    "agency-growth": {
      ...defaults["agency-growth"],
      ...source["agency-growth"],
      pageKey: "agency-growth",
    },
  };
}

function cleanLandingPageSettings(input: Partial<LandingPageCampaignSettings>, pageKey: LandingPageCampaignKey): LandingPageCampaignSettings {
  const defaults = buildDefaultLandingPageSettings()[pageKey];
  return {
    ...defaults,
    pageKey,
    videoUrl: typeof input.videoUrl === "string" ? input.videoUrl.trim() : defaults.videoUrl,
    videoTitle: typeof input.videoTitle === "string" ? input.videoTitle.trim() : defaults.videoTitle,
    countdownEnabled: input.countdownEnabled === true,
    countdownTargetIso: typeof input.countdownTargetIso === "string" ? input.countdownTargetIso.trim() : defaults.countdownTargetIso,
    countdownLabel: typeof input.countdownLabel === "string" ? input.countdownLabel.trim() : defaults.countdownLabel,
    urgencyText: typeof input.urgencyText === "string" ? input.urgencyText.trim() : defaults.urgencyText,
    stickyCtaLabel: typeof input.stickyCtaLabel === "string" ? input.stickyCtaLabel.trim() : defaults.stickyCtaLabel,
    updatedAt: nowIso(),
  };
}

async function readStore(): Promise<PublicGrowthSnapshot> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as Partial<PublicGrowthSnapshot>;
    const packages = Array.isArray(parsed.packages) && parsed.packages.length ? parsed.packages : buildDefaultPackages();
    return {
      packages: packages.slice().sort((left, right) => left.sortOrder - right.sortOrder),
      marketing: parsed.marketing
        ? { ...buildDefaultMarketingSettings(), ...parsed.marketing }
        : buildDefaultMarketingSettings(),
      landingPages: normalizeLandingPageSettings(parsed.landingPages),
      events: Array.isArray(parsed.events) ? parsed.events.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)) : [],
    };
  } catch {
    const snapshot: PublicGrowthSnapshot = {
      packages: buildDefaultPackages(),
      marketing: buildDefaultMarketingSettings(),
      landingPages: buildDefaultLandingPageSettings(),
      events: [],
    };
    await mkdir(STORE_DIRECTORY, { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
    return snapshot;
  }
}

async function writeStore(snapshot: PublicGrowthSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function listRegistrationPackages() {
  return listBillingRegistrationPackages();
}

export async function listActiveRegistrationPackages() {
  return selectLaunchRegistrationPackages(await listActiveBillingRegistrationPackages());
}

export async function findLaunchRegistrationPackage(packageId: string | null | undefined) {
  const normalizedPackageId = packageId?.trim();
  if (!normalizedPackageId) return null;
  const packages = await listActiveRegistrationPackages();
  return packages.find((pkg) => pkg.id === normalizedPackageId || pkg.slug === normalizedPackageId) ?? null;
}

export async function findRegistrationPackage(packageId: string | null | undefined) {
  return findBillingRegistrationPackage(packageId);
}

export async function saveRegistrationPackage(input: Partial<RegistrationPackage> & { id?: string }) {
  return saveBillingRegistrationPackage(input);
}

export async function getMarketingIntegrationSettings() {
  const snapshot = await readStore();
  return snapshot.marketing;
}

export async function saveMarketingIntegrationSettings(input: Partial<MarketingIntegrationSettings>) {
  const snapshot = await readStore();
  snapshot.marketing = {
    ...snapshot.marketing,
    ga4MeasurementId: input.ga4MeasurementId?.trim() ?? snapshot.marketing.ga4MeasurementId,
    gtmContainerId: input.gtmContainerId?.trim() ?? snapshot.marketing.gtmContainerId,
    searchConsoleSiteUrl: input.searchConsoleSiteUrl?.trim() ?? snapshot.marketing.searchConsoleSiteUrl,
    searchConsoleVerification: input.searchConsoleVerification?.trim() ?? snapshot.marketing.searchConsoleVerification,
    metaPixelId: input.metaPixelId?.trim() ?? snapshot.marketing.metaPixelId,
    pixelEndpoint: input.pixelEndpoint?.trim() ?? snapshot.marketing.pixelEndpoint,
    updatedAt: nowIso(),
  };
  await writeStore(snapshot);
  return snapshot.marketing;
}

export async function getLandingPageCampaignSettings() {
  const snapshot = await readStore();
  return snapshot.landingPages;
}

export async function saveLandingPageCampaignSettings(input: Partial<Record<LandingPageCampaignKey, Partial<LandingPageCampaignSettings>>>) {
  const snapshot = await readStore();
  snapshot.landingPages = {
    freelancers: cleanLandingPageSettings(input.freelancers ?? snapshot.landingPages.freelancers, "freelancers"),
    "agency-growth": cleanLandingPageSettings(input["agency-growth"] ?? snapshot.landingPages["agency-growth"], "agency-growth"),
  };
  await writeStore(snapshot);
  return snapshot.landingPages;
}

export async function appendMarketingDebugEvent(input: {
  event: string;
  path?: string | null;
  url?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  payload?: Record<string, unknown>;
}) {
  const snapshot = await readStore();
  const event: MarketingDebugEvent = {
    id: `growth-${randomUUID()}`,
    event: input.event.trim(),
    path: input.path?.trim() || null,
    url: input.url?.trim() || null,
    referrer: input.referrer?.trim() || null,
    userAgent: input.userAgent?.trim() || null,
    payload: input.payload ?? {},
    createdAt: nowIso(),
  };

  snapshot.events = [event, ...(snapshot.events ?? [])].slice(0, 300);
  await writeStore(snapshot);
  return event;
}

export async function listMarketingDebugEvents(limit = 20) {
  const snapshot = await readStore();
  return snapshot.events.slice(0, Math.max(limit, 0));
}

export async function listPromptSearchDemandSuggestions(limit = 16): Promise<PromptSearchDemandSuggestion[]> {
  const snapshot = await readStore();
  const grouped = new Map<string, PromptSearchDemandSuggestion>();

  for (const event of snapshot.events ?? []) {
    if (event.event !== "prompt_search_submitted" && event.event !== "prompt_search_no_result") {
      continue;
    }

    const term = normalizePromptSearchTerm(event.payload.normalizedPrompt ?? event.payload.prompt ?? event.payload.term);
    if (!term || term.length < 2) {
      continue;
    }

    const category = String(event.payload.category ?? "").trim() || null;
    const resultCount = Number(event.payload.resultCount ?? 0);
    const current =
      grouped.get(term) ??
      ({
        term,
        category,
        count: 0,
        noResultCount: 0,
        latestResultCount: Number.isFinite(resultCount) ? resultCount : 0,
        lastSeenAt: event.createdAt,
      } satisfies PromptSearchDemandSuggestion);

    current.count += 1;
    current.noResultCount += event.event === "prompt_search_no_result" ? 1 : 0;
    current.latestResultCount = Number.isFinite(resultCount) ? resultCount : current.latestResultCount;
    current.lastSeenAt = event.createdAt > current.lastSeenAt ? event.createdAt : current.lastSeenAt;
    current.category = current.category ?? category;
    grouped.set(term, current);
  }

  return Array.from(grouped.values())
    .sort((left, right) => {
      const weightDelta = right.noResultCount * 2 + right.count - (left.noResultCount * 2 + left.count);
      return weightDelta || right.lastSeenAt.localeCompare(left.lastSeenAt);
    })
    .slice(0, Math.max(limit, 0));
}

export function getMarketingEventBlueprints() {
  return [
    { event: "gigxomi_prompt_submitted", note: "User submits a matcher brief from the homepage." },
    { event: "gigxomi_search_query", note: "User searches the public service catalog." },
    { event: "gigxomi_service_viewed", note: "Service card enters view or is explicitly selected." },
    { event: "gigxomi_sample_played", note: "A sample player starts on a discovery card." },
    { event: "gigxomi_service_link_opened", note: "User opens the public service details page." },
    { event: "gigxomi_whatsapp_cta_clicked", note: "User clicks the WhatsApp CTA." },
    { event: "gigxomi_auth_modal_opened", note: "Public login/register modal is opened." },
    { event: "gigxomi_auth_submitted", note: "Login or signup form is submitted." },
    { event: "freelancer_landing_viewed", note: "Freelancer landing page is viewed." },
    { event: "freelancer_signup_cta_clicked", note: "Freelancer landing page signup CTA is clicked." },
    { event: "freelancer_demo_cta_clicked", note: "Freelancer landing page demo/how-it-works CTA is clicked." },
    { event: "agency_landing_viewed", note: "Agency growth landing page is viewed." },
    { event: "agency_webinar_cta_clicked", note: "Agency webinar CTA or local webinar form is submitted." },
    { event: "agency_signup_cta_clicked", note: "Agency workspace signup CTA is clicked." },
    { event: "agency_pricing_cta_clicked", note: "Agency pricing/package CTA is clicked." },
    { event: "freelancer_video_play_clicked", note: "Freelancer landing page video player is opened." },
    { event: "agency_video_play_clicked", note: "Agency growth landing page video player is opened." },
    { event: "freelancer_countdown_cta_clicked", note: "Freelancer landing page countdown CTA is clicked." },
    { event: "agency_countdown_cta_clicked", note: "Agency growth landing page countdown CTA is clicked." },
  ] satisfies MarketingEventBlueprint[];
}
