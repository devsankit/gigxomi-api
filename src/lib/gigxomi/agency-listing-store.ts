import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { agencyTenants } from "@/lib/gigxomi/agency-network-data";
import type { AgencyDirectoryCard, KarmaBand } from "@/lib/gigxomi/business-ecosystem-data";
import {
  agencyDirectoryCards,
  agencyPlans,
  agencyProjectPosts,
  editorAgencyMemberships,
  editorInvites,
  editorPerformanceProfiles,
  editorPortfolioRequests,
  getActiveSeatUsage,
} from "@/lib/gigxomi/business-ecosystem-data";
import type {
  AgencyListingProfile,
  AgencyListingUpsertInput,
  AgencyOfficeProfile,
  AgencyOperationalSignals,
  AgencyPublicStats,
  AgencyReputationReason,
  AgencyReputationSnapshot,
  AgencyReview,
  AgencyServiceOffer,
  AgencyShowcaseEditor,
  AgencyShowcaseEditorOption,
} from "@/lib/gigxomi/agency-listing-types";

type AgencyListingStoreSnapshot = {
  profiles: AgencyListingProfile[];
  updatedAt: string;
};

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "agency-listing-store.json");

let queue = Promise.resolve();

type AgencySeedDetail = {
  city: string;
  state: string;
  country: string;
  hasOffice: boolean;
  officeVerified: boolean;
  isAddressPublic: boolean;
  publicOfficeAddress: string;
  officeHours: string;
  contactEmail: string;
  tagline: string;
  description: string;
  categories: string[];
  specialties: string[];
  ctaLabel: string;
  completedOrders: number;
  repeatClientPercent: number;
  responseSlaMinutes: number;
  disputePenalty: number;
  inactivityPenalty: number;
  nonResponsivePenalty: number;
  reviews: Array<{
    rating: number;
    authorLabel: string;
    projectType: string;
    comment: string;
    createdAt: string;
  }>;
};

const agencySeedDetails: Record<string, AgencySeedDetail> = {
  "tenant-gigxomi": {
    city: "Indore",
    state: "Madhya Pradesh",
    country: "India",
    hasOffice: true,
    officeVerified: true,
    isAddressPublic: true,
    publicOfficeAddress: "Orbit Plaza, Vijay Nagar, Indore, Madhya Pradesh",
    officeHours: "Mon-Sat · 10:00 AM - 7:30 PM",
    contactEmail: "studio@gigxomi.com",
    tagline: "Retainer-first editing partner for creator growth and recurring content systems.",
    description:
      "Gigxomi Studio runs high-trust creator operations with routed editors, manager-led quality control, and repeat content systems across YouTube, short-form, and design support.",
    categories: ["Creator growth", "YouTube operations", "Short-form systems"],
    specialties: ["Long-form editing", "Short-form repurposing", "Thumbnail systems", "Retention-driven YouTube edits"],
    ctaLabel: "Message Gigxomi Studio",
    completedOrders: 182,
    repeatClientPercent: 74,
    responseSlaMinutes: 18,
    disputePenalty: 5,
    inactivityPenalty: 2,
    nonResponsivePenalty: 4,
    reviews: [
      {
        rating: 5,
        authorLabel: "Finance creator · Indore",
        projectType: "Monthly YouTube retainer",
        comment: "The agency built a reliable weekly editing lane and response time stayed sharp even during launch weeks.",
        createdAt: "2026-01-18T09:00:00.000Z",
      },
      {
        rating: 4.8,
        authorLabel: "Coach brand · Mumbai",
        projectType: "Webinar repurposing",
        comment: "Delivery stayed organized, revisions were light, and the manager layer made communication very easy.",
        createdAt: "2025-12-12T09:00:00.000Z",
      },
    ],
  },
  "tenant-editors-hub": {
    city: "Ahmedabad",
    state: "Gujarat",
    country: "India",
    hasOffice: true,
    officeVerified: true,
    isAddressPublic: true,
    publicOfficeAddress: "Satellite Business Hub, Ahmedabad, Gujarat",
    officeHours: "Mon-Fri · 10:30 AM - 6:30 PM",
    contactEmail: "hello@editorshub.agency",
    tagline: "Coach, podcast, and webinar workflows built for repeat publishing teams.",
    description:
      "Editors Hub helps coach-led brands and podcast operators keep content moving with recurring production lanes, overflow editing capacity, and retention-focused long-form systems.",
    categories: ["Coach funnels", "Podcast production", "Retainer editing"],
    specialties: ["Podcast editing", "Long-form YouTube", "Webinar repurposing", "Coach content batching"],
    ctaLabel: "Talk to Editors Hub",
    completedOrders: 94,
    repeatClientPercent: 68,
    responseSlaMinutes: 28,
    disputePenalty: 8,
    inactivityPenalty: 4,
    nonResponsivePenalty: 6,
    reviews: [
      {
        rating: 4.7,
        authorLabel: "Podcast network · Bengaluru",
        projectType: "Weekly podcast clips",
        comment: "Reliable batch processing and strong polish on subtitles, hooks, and recurring deadlines.",
        createdAt: "2026-02-09T09:00:00.000Z",
      },
      {
        rating: 4.6,
        authorLabel: "Coach business · Delhi",
        projectType: "Coach retainer",
        comment: "Good communication rhythm and flexible overflow support when we needed more clip volume.",
        createdAt: "2025-11-28T09:00:00.000Z",
      },
    ],
  },
  "tenant-ppw": {
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    hasOffice: false,
    officeVerified: false,
    isAddressPublic: false,
    publicOfficeAddress: "",
    officeHours: "By appointment",
    contactEmail: "bookings@ppwcreative.in",
    tagline: "Wedding storytelling studio for same-week teasers and cinematic highlight edits.",
    description:
      "PPW Creative focuses on wedding and event storytelling with teaser reels, albums, and highlight edits for seasonal event demand.",
    categories: ["Wedding films", "Event storytelling"],
    specialties: ["Wedding teasers", "Highlight reels", "Album edits"],
    ctaLabel: "Request wedding edit",
    completedOrders: 21,
    repeatClientPercent: 41,
    responseSlaMinutes: 96,
    disputePenalty: 14,
    inactivityPenalty: 12,
    nonResponsivePenalty: 11,
    reviews: [
      {
        rating: 4.4,
        authorLabel: "Wedding planner · Lucknow",
        projectType: "Teaser package",
        comment: "The creative quality is promising, but the agency still needs tighter activation and reply discipline.",
        createdAt: "2026-01-05T09:00:00.000Z",
      },
    ],
  },
  "tenant-omni-flow": {
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    hasOffice: true,
    officeVerified: true,
    isAddressPublic: true,
    publicOfficeAddress: "Embassy Tech Village, Bengaluru, Karnataka",
    officeHours: "Mon-Sat · 11:00 AM - 8:00 PM",
    contactEmail: "growth@omniflow.studio",
    tagline: "High-volume D2C creative ops with fast hooks, UGC repurposing, and ad-edit systems.",
    description:
      "OmniFlow Studio runs fast-turnaround D2C ad production with repeat brand lanes, hook testing, and strict manager-led QA for performance creatives.",
    categories: ["D2C creative ops", "UGC systems", "Performance ads"],
    specialties: ["Ad creative", "UGC repurposing", "Conversion edits", "Retention hooks"],
    ctaLabel: "Explore OmniFlow",
    completedOrders: 137,
    repeatClientPercent: 71,
    responseSlaMinutes: 22,
    disputePenalty: 11,
    inactivityPenalty: 3,
    nonResponsivePenalty: 5,
    reviews: [
      {
        rating: 4.9,
        authorLabel: "Skincare brand · Bengaluru",
        projectType: "Monthly ad sprint",
        comment: "The agency moves fast, keeps the ad lane organized, and understands conversion-first creative feedback.",
        createdAt: "2026-02-16T09:00:00.000Z",
      },
      {
        rating: 4.7,
        authorLabel: "D2C founder · Mumbai",
        projectType: "UGC repurposing retainer",
        comment: "Very strong production speed and systems thinking, though timelines stay tight when volume spikes.",
        createdAt: "2025-12-21T09:00:00.000Z",
      },
    ],
  },
};

function nowIso() {
  return new Date().toISOString();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizePhone(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) {
    return "";
  }

  return digits.startsWith("91") ? `+${digits}` : `+91${digits}`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toRatingAverage(reviews: AgencyReview[]) {
  if (!reviews.length) {
    return 0;
  }

  return Number((reviews.reduce((total, review) => total + review.rating, 0) / reviews.length).toFixed(1));
}

function getBand(score: number): KarmaBand {
  if (score >= 90) {
    return "Elite";
  }

  if (score >= 82) {
    return "Trusted";
  }

  if (score >= 70) {
    return "Stable";
  }

  return "At Risk";
}

function buildReputationReasons(signals: AgencyOperationalSignals, stats: AgencyPublicStats): AgencyReputationReason[] {
  const reasons: AgencyReputationReason[] = [
    {
      label: "Response SLA",
      value: `${stats.responseSlaMinutes} min avg`,
      tone: stats.responseSlaMinutes <= 30 ? "positive" : stats.responseSlaMinutes <= 90 ? "neutral" : "watch",
    },
    {
      label: "Completion rate",
      value: `${signals.completionRate}%`,
      tone: signals.completionRate >= 90 ? "positive" : signals.completionRate >= 78 ? "neutral" : "watch",
    },
    {
      label: "Repeat clients",
      value: `${stats.repeatClientPercent}%`,
      tone: stats.repeatClientPercent >= 60 ? "positive" : stats.repeatClientPercent >= 40 ? "neutral" : "watch",
    },
    {
      label: "Review health",
      value: `${stats.averageRating}/5`,
      tone: stats.averageRating >= 4.7 ? "positive" : stats.averageRating >= 4.2 ? "neutral" : "watch",
    },
  ];

  reasons.sort((left, right) => {
    const toneWeight = { positive: 0, neutral: 1, watch: 2 } satisfies Record<AgencyReputationReason["tone"], number>;
    return toneWeight[left.tone] - toneWeight[right.tone];
  });

  return reasons.slice(0, 3);
}

function computeReputationSnapshot(signals: AgencyOperationalSignals, stats: AgencyPublicStats, lastCalculatedAt = nowIso()): AgencyReputationSnapshot {
  const reviewScore = clamp(Math.round((signals.reviewRating / 5) * 100), 0, 100);
  const responseScore = clamp(100 - Math.round(Math.min(signals.responseSlaMinutes, 180) / 1.8), 0, 100);
  const disciplineScore = clamp(100 - signals.disputePenalty * 4, 0, 100);
  const availabilityScore = clamp(100 - Math.round((signals.inactivityPenalty + signals.nonResponsivePenalty) * 3.5), 0, 100);
  const score = Math.round(
    clamp(
      responseScore * 0.22 +
        signals.completionRate * 0.28 +
        reviewScore * 0.2 +
        signals.repeatClientPercent * 0.16 +
        disciplineScore * 0.08 +
        availabilityScore * 0.06,
      0,
      100,
    ),
  );

  return {
    score,
    band: getBand(score),
    reasons: buildReputationReasons(signals, stats),
    lastCalculatedAt,
  };
}

function computeSetupCompletion(profile: Omit<AgencyListingProfile, "completionPercent" | "isSetupComplete" | "publishStage" | "isPublished" | "stats" | "reputation"> & {
  stats: AgencyPublicStats;
  reputation: AgencyReputationSnapshot;
  isPublished?: boolean;
}) {
  const checks = [
    Boolean(profile.publicName.trim()),
    Boolean(profile.slug.trim()),
    Boolean(profile.tagline.trim()),
    Boolean(profile.description.trim()),
    Boolean(profile.niche.trim()),
    profile.categories.length > 0,
    profile.specialties.length > 0,
    Boolean(profile.ctaLabel.trim()),
    Boolean(profile.whatsappNumber.trim()),
    Boolean(profile.office.city.trim()),
    Boolean(profile.office.state.trim()),
    Boolean(profile.office.country.trim()),
    !profile.office.hasOffice || Boolean(profile.office.officeHours.trim()),
    !profile.office.hasOffice || !profile.office.isAddressPublic || Boolean(profile.office.publicOfficeAddress.trim()),
    profile.showcaseEditors.length > 0,
    profile.serviceOffers.length > 0,
  ];

  const completed = checks.filter(Boolean).length;
  const completionPercent = Math.round((completed / checks.length) * 100);
  const isSetupComplete = completed === checks.length;
  const isPublished = Boolean(profile.isPublished) && isSetupComplete && profile.status === "Active";
  const publishStage = isPublished ? "PUBLISHED" : isSetupComplete ? "READY" : "DRAFT";

  return {
    completionPercent,
    isSetupComplete,
    isPublished,
    publishStage,
  } as const;
}

function buildReviewSeed(agencyId: string) {
  const detail = agencySeedDetails[agencyId];
  if (!detail) {
    return [];
  }

  return detail.reviews.map((review, index) => ({
    id: `${agencyId}-review-${index + 1}`,
    rating: review.rating,
    authorLabel: review.authorLabel,
    projectType: review.projectType,
    comment: review.comment,
    createdAt: review.createdAt,
    verified: true,
  })) satisfies AgencyReview[];
}

function buildShowcaseEditors(agencyId: string, selectedEditorIds?: string[]) {
  const selectedIds =
    selectedEditorIds && selectedEditorIds.length
      ? selectedEditorIds
      : uniqueStrings([
          ...editorAgencyMemberships.filter((membership) => membership.agencyId === agencyId).map((membership) => membership.editorId),
          ...agencyProjectPosts.filter((project) => project.agencyId === agencyId).flatMap((project) => project.matchedEditorIds),
        ]).slice(0, 4);

  return selectedIds
    .map((editorId) => {
      const editor = editorPerformanceProfiles.find((candidate) => candidate.id === editorId);
      if (!editor) {
        return null;
      }

      const membership = editorAgencyMemberships.find((item) => item.agencyId === agencyId && item.editorId === editorId);
      const highlight =
        membership?.status === "Active"
          ? `Active ${membership.role.toLowerCase()} with ${editor.karma.score}/100 karma and ${editor.leader.tier.toLowerCase()} leader tier performance.`
          : `Shortlisted for ${editor.specialties[0]?.toLowerCase() ?? "editing"} with ${editor.karma.score}/100 operational trust.`;

      return {
        editorId: editor.id,
        displayName: editor.name,
        publicAlias: editor.publicAlias,
        specialties: editor.specialties,
        highlight,
        karmaScore: editor.karma.score,
        leaderTier: editor.leader.tier,
        membershipStatus: membership?.status ?? "Requested",
      } satisfies AgencyShowcaseEditor;
    })
    .filter((item): item is AgencyShowcaseEditor => Boolean(item));
}

function buildServiceOffers(agencyId: string, providedOffers?: AgencyServiceOffer[]) {
  if (providedOffers?.length) {
    return providedOffers;
  }

  const seededOffers = agencyProjectPosts
    .filter((project) => project.agencyId === agencyId)
    .slice(0, 3)
    .map((project, index) => ({
      id: `${agencyId}-offer-${index + 1}`,
      title: project.title,
      priceLabel: project.budgetRange,
      summary: `${project.specialty} · ${project.turnaround}`,
    }));

  if (seededOffers.length) {
    return seededOffers;
  }

  return [
    {
      id: `${agencyId}-offer-1`,
      title: "Managed content lane",
      priceLabel: "Custom pricing",
      summary: "Agency-led delivery with curated editor routing.",
    },
  ];
}

function createProfileFromSeed(card: AgencyDirectoryCard): AgencyListingProfile {
  const tenant = agencyTenants.find((item) => item.id === card.id);
  const plan = agencyPlans.find((item) => item.agencyId === card.id);
  const seed = agencySeedDetails[card.id] ?? {
    city: card.location,
    state: "India",
    country: "India",
    hasOffice: false,
    officeVerified: false,
    isAddressPublic: false,
    publicOfficeAddress: "",
    officeHours: "By appointment",
    contactEmail: `hello@${card.slug}.gigxomi.local`,
    tagline: card.niche,
    description: `${card.trustSummary} ${card.growthSummary}`.trim(),
    categories: [card.niche],
    specialties: card.activeServices.split(",").map((item) => item.trim()),
    ctaLabel: card.showcaseCta,
    completedOrders: 12,
    repeatClientPercent: 34,
    responseSlaMinutes: 75,
    disputePenalty: 10,
    inactivityPenalty: 8,
    nonResponsivePenalty: 7,
    reviews: [],
  };

  const reviews = buildReviewSeed(card.id);
  const activeEditors = getActiveSeatUsage(card.id) || card.activeEditors;
  const stats: AgencyPublicStats = {
    completedOrders: seed.completedOrders,
    averageRating: toRatingAverage(reviews),
    reviewCount: reviews.length,
    repeatClientPercent: seed.repeatClientPercent,
    responseSlaMinutes: seed.responseSlaMinutes,
    activeEditors,
    openOpportunities: card.openOpportunities,
  };

  const signals: AgencyOperationalSignals = {
    responseSlaMinutes: seed.responseSlaMinutes,
    completionRate: clamp(70 + activeEditors + (plan ? Math.round((plan.activeSeats / plan.seatLimit) * 12) : 0), 70, 97),
    reviewRating: stats.averageRating || 4.2,
    repeatClientPercent: seed.repeatClientPercent,
    disputePenalty: seed.disputePenalty,
    inactivityPenalty: seed.inactivityPenalty,
    nonResponsivePenalty: seed.nonResponsivePenalty,
  };

  const profileBase = {
    id: card.id,
    tenantId: card.id,
    slug: card.slug,
    publicName: card.name,
    ownerName: card.owner,
    whatsappNumber: normalizePhone(tenant?.whatsappNumber ?? card.whatsappNumber),
    contactEmail: seed.contactEmail,
    logoUrl: null,
    coverUrl: null,
    tagline: seed.tagline,
    description: seed.description,
    niche: card.niche,
    categories: uniqueStrings(seed.categories),
    specialties: uniqueStrings(seed.specialties),
    ctaLabel: seed.ctaLabel,
    status: tenant?.status ?? "Active",
    hiringStatus: card.hiringStatus,
    office: {
      city: seed.city,
      state: seed.state,
      country: seed.country,
      hasOffice: seed.hasOffice,
      officeVerified: seed.officeVerified,
      isAddressPublic: seed.isAddressPublic,
      publicOfficeAddress: seed.publicOfficeAddress,
      officeHours: seed.officeHours,
    } satisfies AgencyOfficeProfile,
    signals,
    stats,
    reputation: computeReputationSnapshot(signals, stats, nowIso()),
    reviews,
    showcaseEditors: buildShowcaseEditors(card.id),
    serviceOffers: buildServiceOffers(card.id),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    isPublished: (tenant?.status ?? "Active") === "Active" && card.id !== "tenant-ppw",
  };

  const setup = computeSetupCompletion(profileBase);

  return {
    ...profileBase,
    ...setup,
  };
}

function buildSeededProfiles() {
  return agencyDirectoryCards.map(createProfileFromSeed);
}

async function readStore() {
  try {
    const contents = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(contents) as Partial<AgencyListingStoreSnapshot>;

    return {
      profiles: Array.isArray(parsed.profiles) && parsed.profiles.length ? parsed.profiles : buildSeededProfiles(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
    } satisfies AgencyListingStoreSnapshot;
  } catch {
    const seeded: AgencyListingStoreSnapshot = {
      profiles: buildSeededProfiles(),
      updatedAt: nowIso(),
    };
    await mkdir(STORE_DIRECTORY, { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(seeded, null, 2), "utf8");
    return seeded;
  }
}

async function writeStore(store: AgencyListingStoreSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function withStore<T>(action: (store: AgencyListingStoreSnapshot) => Promise<T> | T, options?: { persist?: boolean }) {
  const run = async () => {
    const store = await readStore();
    const result = await action(store);

    if (options?.persist !== false) {
      store.updatedAt = nowIso();
      await writeStore(store);
    }

    return result;
  };

  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function recalculateProfile(profile: Omit<AgencyListingProfile, "completionPercent" | "isSetupComplete" | "publishStage">) {
  const reviews = profile.reviews.map((review) => ({
    ...review,
    rating: clamp(Number(review.rating), 1, 5),
  }));
  const stats: AgencyPublicStats = {
    ...profile.stats,
    averageRating: toRatingAverage(reviews),
    reviewCount: reviews.length,
    activeEditors: profile.stats.activeEditors || getActiveSeatUsage(profile.tenantId),
  };
  const signals: AgencyOperationalSignals = {
    ...profile.signals,
    reviewRating: stats.averageRating || profile.signals.reviewRating,
    repeatClientPercent: stats.repeatClientPercent,
    responseSlaMinutes: stats.responseSlaMinutes,
  };
  const reputation = computeReputationSnapshot(signals, stats, nowIso());
  const setup = computeSetupCompletion({
    ...profile,
    reviews,
    signals,
    stats,
    reputation,
  });

  return {
    ...profile,
    reviews,
    signals,
    stats,
    reputation,
    updatedAt: nowIso(),
    ...setup,
  } satisfies AgencyListingProfile;
}

function createDraftProfileForTenant(input: {
  tenantId: string;
  publicName: string;
  ownerName: string;
  whatsappNumber: string;
  contactEmail?: string | null;
}) {
  const now = nowIso();
  const slug = slugify(input.publicName) || input.tenantId;
  const profileBase = {
    id: input.tenantId,
    tenantId: input.tenantId,
    slug,
    publicName: input.publicName,
    ownerName: input.ownerName,
    whatsappNumber: normalizePhone(input.whatsappNumber),
    contactEmail: input.contactEmail?.trim().toLowerCase() ?? "",
    websiteUrl: "",
    instagramHandle: "",
    logoUrl: null,
    coverUrl: null,
    tagline: "",
    description: "",
    niche: "",
    categories: [],
    specialties: [],
    ctaLabel: "Talk to agency",
    status: "Active" as const,
    hiringStatus: "Actively hiring" as const,
    office: {
      city: "",
      state: "",
      country: "India",
      hasOffice: false,
      officeVerified: false,
      isAddressPublic: false,
      publicOfficeAddress: "",
      officeHours: "",
    },
    signals: {
      responseSlaMinutes: 60,
      completionRate: 76,
      reviewRating: 4.2,
      repeatClientPercent: 28,
      disputePenalty: 10,
      inactivityPenalty: 8,
      nonResponsivePenalty: 9,
    },
    stats: {
      completedOrders: 0,
      averageRating: 0,
      reviewCount: 0,
      repeatClientPercent: 28,
      responseSlaMinutes: 60,
      activeEditors: 0,
      openOpportunities: 0,
    },
    reputation: {
      score: 0,
      band: "Stable" as const,
      reasons: [],
      lastCalculatedAt: now,
    },
    reviews: [],
    showcaseEditors: [],
    serviceOffers: [],
    createdAt: now,
    updatedAt: now,
    isPublished: false,
  };

  return recalculateProfile(profileBase);
}

function applyProfileUpdate(profile: AgencyListingProfile, input: AgencyListingUpsertInput) {
  const contactEmail = input.contactEmail.trim().toLowerCase();
  const nextServiceOffers = input.serviceOffers
    .map((offer, index) => ({
      id: `${profile.tenantId}-custom-offer-${index + 1}`,
      title: offer.title.trim(),
      priceLabel: offer.priceLabel.trim(),
      summary: offer.summary.trim(),
    }))
    .filter((offer) => offer.title && offer.priceLabel && offer.summary);

  const updated: AgencyListingProfile = {
    ...profile,
    slug: slugify(input.slug) || profile.slug,
    publicName: input.publicName.trim() || profile.publicName,
    contactEmail,
    whatsappNumber: normalizePhone(input.whatsappNumber) || profile.whatsappNumber,
    websiteUrl: input.websiteUrl !== undefined ? input.websiteUrl.trim() : profile.websiteUrl ?? "",
    instagramHandle: input.instagramHandle !== undefined ? input.instagramHandle.trim() : profile.instagramHandle ?? "",
    logoUrl: input.logoUrl?.trim() || null,
    coverUrl: input.coverUrl?.trim() || null,
    tagline: input.tagline.trim(),
    description: input.description.trim(),
    niche: input.niche.trim(),
    categories: uniqueStrings(input.categories),
    specialties: uniqueStrings(input.specialties),
    ctaLabel: input.ctaLabel.trim() || profile.ctaLabel,
    hiringStatus: input.hiringStatus,
    office: {
      ...input.office,
      city: input.office.city.trim(),
      state: input.office.state.trim(),
      country: input.office.country.trim() || "India",
      publicOfficeAddress: input.office.publicOfficeAddress.trim(),
      officeHours: input.office.officeHours.trim(),
    },
    showcaseEditors: buildShowcaseEditors(profile.tenantId, input.showcaseEditorIds),
    serviceOffers: nextServiceOffers,
    isPublished: input.isPublished,
  };

  return recalculateProfile(updated);
}

export function ensureAgencyListingForTenantFromFile(input: {
  tenantId: string;
  publicName: string;
  ownerName?: string | null;
  whatsappNumber: string;
  contactEmail?: string | null;
}) {
  return withStore((store) => {
    const existing = store.profiles.find((profile) => profile.tenantId === input.tenantId);
    if (existing) {
      return existing;
    }

    const profile = createDraftProfileForTenant({
      tenantId: input.tenantId,
      publicName: input.publicName,
      ownerName: input.ownerName?.trim() || input.publicName,
      whatsappNumber: input.whatsappNumber,
      contactEmail: input.contactEmail ?? "",
    });
    store.profiles.push(profile);
    return profile;
  });
}

export function getAgencyListingByTenantIdFromFile(tenantId: string) {
  return withStore((store) => store.profiles.find((profile) => profile.tenantId === tenantId) ?? null, { persist: false });
}

export function listAgencyListingsFromFile() {
  return withStore((store) => store.profiles.slice().sort((left, right) => left.publicName.localeCompare(right.publicName)), { persist: false });
}

export function listPublicAgencyListingsFromFile() {
  return withStore(
    (store) =>
      store.profiles
        .filter((profile) => profile.status === "Active" && profile.isSetupComplete && profile.isPublished)
        .sort((left, right) => {
          if (left.reputation.score !== right.reputation.score) {
            return right.reputation.score - left.reputation.score;
          }

          return right.stats.completedOrders - left.stats.completedOrders;
        }),
    { persist: false },
  );
}

export function getPublicAgencyListingBySlugFromFile(slug: string) {
  return withStore(
    (store) =>
      store.profiles.find((profile) => profile.slug === slug && profile.status === "Active" && profile.isSetupComplete && profile.isPublished) ?? null,
    { persist: false },
  );
}

export function updateAgencyListingFromFile(tenantId: string, input: AgencyListingUpsertInput) {
  return withStore((store) => {
    const profile = store.profiles.find((item) => item.tenantId === tenantId);
    if (!profile) {
      return null;
    }

    const updated = applyProfileUpdate(profile, input);
    const index = store.profiles.findIndex((item) => item.tenantId === tenantId);
    store.profiles[index] = updated;
    return updated;
  });
}

export function updateAgencyListingNameFromFile(tenantId: string, publicName: string) {
  return withStore((store) => {
    const profile = store.profiles.find((item) => item.tenantId === tenantId);
    if (!profile) {
      return null;
    }

    profile.publicName = publicName.trim() || profile.publicName;
    const index = store.profiles.findIndex((item) => item.tenantId === tenantId);
    store.profiles[index] = recalculateProfile(profile);
    return store.profiles[index];
  });
}

export function getAgencyShowcaseEditorOptionsFromFile(tenantId: string) {
  return withStore(() => {
    const options = editorPerformanceProfiles.map((editor) => {
      const membership = editorAgencyMemberships.find((item) => item.agencyId === tenantId && item.editorId === editor.id) ?? null;

      return {
        editorId: editor.id,
        displayName: editor.name,
        publicAlias: editor.publicAlias,
        specialties: editor.specialties,
        membershipStatus: membership?.status ?? null,
        isAgencyMember: Boolean(membership),
      } satisfies AgencyShowcaseEditorOption;
    });

    options.sort((left, right) => {
      if (left.isAgencyMember !== right.isAgencyMember) {
        return left.isAgencyMember ? -1 : 1;
      }

      return left.displayName.localeCompare(right.displayName);
    });

    return options;
  }, { persist: false });
}

export function getAgencyListingsForFreelancerFromFile() {
  return withStore((store) => {
    const relevantAgencyIds = uniqueStrings([
      ...editorInvites.map((item) => item.agencyId),
      ...editorPortfolioRequests.map((item) => item.agencyId),
      ...editorAgencyMemberships.map((item) => item.agencyId),
      ...agencyProjectPosts.map((item) => item.agencyId),
    ]);

    return store.profiles.filter((profile) => relevantAgencyIds.includes(profile.tenantId));
  }, { persist: false });
}
