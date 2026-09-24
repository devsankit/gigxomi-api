import type { TenantStatus } from "@/lib/gigxomi/agency-network-data";
import type { HiringStatus, KarmaBand, RewardTier, TeamMembershipStatus } from "@/lib/gigxomi/business-ecosystem-data";

export type AgencyListingStage = "DRAFT" | "READY" | "PUBLISHED";

export type AgencyOfficeProfile = {
  city: string;
  state: string;
  country: string;
  hasOffice: boolean;
  officeVerified: boolean;
  isAddressPublic: boolean;
  publicOfficeAddress: string;
  officeHours: string;
};

export type AgencyOperationalSignals = {
  responseSlaMinutes: number;
  completionRate: number;
  reviewRating: number;
  repeatClientPercent: number;
  disputePenalty: number;
  inactivityPenalty: number;
  nonResponsivePenalty: number;
};

export type AgencyReputationReason = {
  label: string;
  value: string;
  tone: "positive" | "watch" | "neutral";
};

export type AgencyReputationSnapshot = {
  score: number;
  band: KarmaBand;
  reasons: AgencyReputationReason[];
  lastCalculatedAt: string;
};

export type AgencyReview = {
  id: string;
  rating: number;
  authorLabel: string;
  projectType: string;
  comment: string;
  createdAt: string;
  verified: boolean;
};

export type AgencyShowcaseEditor = {
  editorId: string;
  displayName: string;
  publicAlias: string;
  specialties: string[];
  highlight: string;
  karmaScore: number;
  leaderTier: RewardTier;
  membershipStatus: TeamMembershipStatus;
};

export type AgencyServiceOffer = {
  id: string;
  title: string;
  priceLabel: string;
  summary: string;
};

export type AgencyPublicStats = {
  completedOrders: number;
  averageRating: number;
  reviewCount: number;
  repeatClientPercent: number;
  responseSlaMinutes: number;
  activeEditors: number;
  openOpportunities: number;
};

export type AgencyListingProfile = {
  id: string;
  tenantId: string;
  slug: string;
  publicName: string;
  ownerName: string;
  whatsappNumber: string;
  contactEmail: string;
  websiteUrl?: string;
  instagramHandle?: string;
  logoUrl: string | null;
  coverUrl: string | null;
  tagline: string;
  description: string;
  niche: string;
  categories: string[];
  specialties: string[];
  ctaLabel: string;
  status: TenantStatus;
  hiringStatus: HiringStatus;
  office: AgencyOfficeProfile;
  signals: AgencyOperationalSignals;
  stats: AgencyPublicStats;
  reputation: AgencyReputationSnapshot;
  reviews: AgencyReview[];
  showcaseEditors: AgencyShowcaseEditor[];
  serviceOffers: AgencyServiceOffer[];
  publishStage: AgencyListingStage;
  completionPercent: number;
  isSetupComplete: boolean;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgencyListingUpsertInput = {
  publicName: string;
  slug: string;
  contactEmail: string;
  whatsappNumber: string;
  websiteUrl?: string;
  instagramHandle?: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  tagline: string;
  description: string;
  niche: string;
  categories: string[];
  specialties: string[];
  ctaLabel: string;
  hiringStatus: HiringStatus;
  office: AgencyOfficeProfile;
  showcaseEditorIds: string[];
  serviceOffers: Array<{
    title: string;
    priceLabel: string;
    summary: string;
  }>;
  isPublished: boolean;
};

export type AgencyShowcaseEditorOption = {
  editorId: string;
  displayName: string;
  publicAlias: string;
  specialties: string[];
  membershipStatus: TeamMembershipStatus | null;
  isAgencyMember: boolean;
};
