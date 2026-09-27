import { NextResponse } from "next/server";

import { listPublicAgencyListingsFromFile } from "@/lib/gigxomi/agency-listing-store";
import type { AgencyListingProfile } from "@/lib/gigxomi/agency-listing-types";
import { checkTeamPortfolioRateLimit } from "@/lib/api/rate-limit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://gigxomi.com",
  "https://www.gigxomi.com",
  "https://app.gigxomi.com",
  "https://agency.gigxomi.com",
  "http://localhost:3000",
  "http://localhost:3002",
  "http://localhost:3020",
];

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, X-Api-Key, Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

function absoluteAssetUrl(value: string | null | undefined, request: Request) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const assetUrl = new URL(trimmed, new URL(request.url).origin);
    return assetUrl.protocol === "http:" || assetUrl.protocol === "https:" ? assetUrl.toString() : null;
  } catch {
    return null;
  }
}

const KNOWN_AGENCY_DOMAINS: Record<string, string> = {
  "apex-motion": "https://apexmotion.studio",
  "two-edits": "https://twoedits.com",
};

const CURATED_STUDIO_COVERS = [
  "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1536240478700-b869070f9279?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&auto=format&fit=crop&q=80",
];

function getAgencyFallbackCover(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash << 5) - hash + slug.charCodeAt(i);
    hash |= 0;
  }
  return CURATED_STUDIO_COVERS[Math.abs(hash) % CURATED_STUDIO_COVERS.length];
}

function getAgencyFallbackLogo(name: string): string {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name.trim())}&backgroundColor=0f172a,1e293b,111827&textColor=d7ff2f,38bdf8,818cf8`;
}

function absoluteWebsiteUrl(value: string | undefined, slug: string) {
  if (KNOWN_AGENCY_DOMAINS[slug]) {
    return KNOWN_AGENCY_DOMAINS[slug];
  }

  const trimmed = value?.trim();
  if (trimmed && !trimmed.includes("example.com")) {
    try {
      const websiteUrl = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      if (websiteUrl.protocol === "http:" || websiteUrl.protocol === "https:") {
        return websiteUrl.toString();
      }
    } catch {
      // Fall through to default template
    }
  }

  return `https://agency.gigxomi.com/${encodeURIComponent(slug)}`;
}

function extractApiKey(request: Request): string | null {
  const headerKey = request.headers.get("x-api-key");
  if (headerKey?.trim()) return headerKey.trim();

  const authHeader = request.headers.get("authorization");
  if (authHeader && typeof authHeader === "string") {
    const [scheme, ...rest] = authHeader.trim().split(/\s+/);
    if (scheme?.toLowerCase() === "bearer") {
      return rest.join(" ").trim() || null;
    }
  }
  return null;
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "agency";
}

function profileFromAgencyAccount(account: {
  id: string;
  tenantId: string | null;
  displayName: string;
  phone?: string | null;
  email?: string | null;
  packageStatus: "ACTIVE" | "PAUSED" | "EXPIRED" | null;
  createdAt: Date;
}): AgencyListingProfile {
  const publicName = account.displayName.trim() || "GigXomi agency";
  const slug = `${slugify(publicName)}-${account.id.slice(-6).toLowerCase()}`;
  const isExpired = account.packageStatus === "EXPIRED";
  const updatedAt = account.createdAt.toISOString();
  const rawPhone = account.phone?.trim() || "";
  const isValidPhone = rawPhone && !rawPhone.startsWith("+google-") && !rawPhone.startsWith("+email-");
  const whatsappNumber = isValidPhone ? rawPhone : "";
  const contactEmail = account.email?.trim() || "";

  return {
    id: account.tenantId || account.id,
    tenantId: account.tenantId || account.id,
    slug,
    publicName,
    ownerName: publicName,
    whatsappNumber,
    contactEmail,
    websiteUrl: `https://agency.gigxomi.com/${encodeURIComponent(slug)}`,
    logoUrl: null,
    coverUrl: null,
    tagline: "Video editing and creative production",
    description: "This agency is part of the GigXomi network. Their public profile is being completed by the agency team.",
    niche: "Video editing and creative production",
    categories: ["Video editing"],
    specialties: ["Video editing", "Creative production"],
    ctaLabel: "View agency profile",
    status: isExpired ? "Suspended" : "Active",
    hiringStatus: account.packageStatus === "ACTIVE" ? "Selective hiring" : "Invite only",
    office: {
      city: "Remote",
      state: "",
      country: "India",
      hasOffice: false,
      officeVerified: false,
      isAddressPublic: false,
      publicOfficeAddress: "",
      officeHours: "By appointment",
    },
    signals: {
      responseSlaMinutes: 0,
      completionRate: 0,
      reviewRating: 0,
      repeatClientPercent: 0,
      disputePenalty: 0,
      inactivityPenalty: 0,
      nonResponsivePenalty: 0,
    },
    stats: {
      completedOrders: 0,
      averageRating: 0,
      reviewCount: 0,
      repeatClientPercent: 0,
      responseSlaMinutes: 0,
      activeEditors: 0,
      openOpportunities: 0,
    },
    reputation: {
      score: 0,
      band: "At Risk",
      reasons: [],
      lastCalculatedAt: updatedAt,
    },
    reviews: [],
    showcaseEditors: [],
    serviceOffers: [],
    publishStage: "PUBLISHED",
    completionPercent: 0,
    isSetupComplete: false,
    isPublished: true,
    createdAt: updatedAt,
    updatedAt,
  };
}

export async function GET(request: Request) {
  const corsHeaders = getCorsHeaders(request);
  const rateLimitKey = `public-agencies:${request.headers.get("x-forwarded-for") || "direct"}`;
  const rateLimit = checkTeamPortfolioRateLimit(rateLimitKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again later." },
      { status: 429, headers: corsHeaders },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 20, 1), 100) : 20;
  const filterCity = searchParams.get("city")?.trim().toLowerCase();
  const filterSpecialty = searchParams.get("specialty")?.trim().toLowerCase();
  const searchQuery = searchParams.get("q")?.trim().toLowerCase();

  const profiles = await listPublicAgencyListingsFromFile();
  let agencyAccounts: Array<Parameters<typeof profileFromAgencyAccount>[0]> = [];

  try {
    agencyAccounts = await prisma.appAuthUser.findMany({
      where: {
        NOT: { role: "SUPER_ADMIN" },
        OR: [
          { packageAudience: "AGENCY" },
          { workspaceMode: "AGENCY" },
          { role: "ADMIN" },
          { assignedRole: "ADMIN" },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        displayName: true,
        phone: true,
        email: true,
        packageStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    agencyAccounts = [];
  }

  const publishedTenantIds = new Set(profiles.map((profile) => profile.tenantId));
  const directoryProfiles = [
    ...profiles,
    ...agencyAccounts
      .filter((account) => !publishedTenantIds.has(account.tenantId || account.id))
      .map(profileFromAgencyAccount),
  ];

  // 1. Fetch all active team memberships in a single bulk query (instant, no N+1 query loop)
  let allActiveMemberships: Array<{
    tenantId: string;
    agencyName: string;
    freelancerName: string;
    roleType: string;
  }> = [];

  try {
    allActiveMemberships = await (prisma as any).appTeamMembership.findMany({
      where: { status: "ACTIVE" },
      select: {
        tenantId: true,
        agencyName: true,
        freelancerName: true,
        roleType: true,
      },
    });
  } catch {
    allActiveMemberships = [];
  }

  const agencies = directoryProfiles.map((profile) => {
    // Find matching active members from DB
    const matchedMembers = allActiveMemberships.filter((m) => {
      const tenantMatch = Boolean(
        (profile.id && m.tenantId === profile.id) ||
        (profile.tenantId && m.tenantId === profile.tenantId)
      );
      const nameMatch = Boolean(
        m.agencyName &&
        profile.publicName &&
        m.agencyName.trim().toLowerCase() === profile.publicName.trim().toLowerCase()
      );
      return tenantMatch || nameMatch;
    });

    const dbActiveCount = matchedMembers.length;
    const seedActiveCount = profile.stats?.activeEditors || 0;
    const activeFreelancersCount = Math.max(dbActiveCount, seedActiveCount);

    // Build active team members detail list
    let teamMembers: Array<{ name: string; role: string }> = [];
    if (matchedMembers.length > 0) {
      teamMembers = matchedMembers.map((m) => ({
        name: m.freelancerName,
        role: m.roleType || "In-house Video Editor",
      }));
    } else if (profile.showcaseEditors && profile.showcaseEditors.length > 0) {
      teamMembers = profile.showcaseEditors.map((e) => ({
        name: e.displayName || e.publicAlias,
        role: e.specialties?.[0] || "In-house Video Editor",
      }));
    }

    // Extract editor initials for avatar signals
    let editorInitials: string[] = [];
    if (teamMembers.length > 0) {
      editorInitials = teamMembers.slice(0, 5).map((m) =>
        m.name
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
      );
    } else {
      editorInitials = [];
    }

    const website = absoluteWebsiteUrl(profile.websiteUrl, profile.slug);
    const agencyStudioUrl = `https://agency.gigxomi.com/${encodeURIComponent(profile.slug)}`;
    const publicProfileUrl = `https://www.gigxomi.com/agency/${encodeURIComponent(profile.slug)}`;

    return {
      id: profile.id,
      tenantId: profile.tenantId || profile.id,
      slug: profile.slug,
      name: profile.publicName,
      mark: profile.publicName
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      location: profile.office.city || profile.office.country || "Remote",
      city: profile.office.city || "",
      state: profile.office.state || "",
      country: profile.office.country || "India",
      specialty: profile.niche || profile.tagline || "Video editing and creative production",
      tagline: profile.tagline || "",
      description: profile.description || profile.tagline || "A published creative team on the GigXomi network.",

      // Active team members count & details
      activeTeamMembers: activeFreelancersCount,
      activeTeamMembersCount: activeFreelancersCount,
      totalTeamMembers: activeFreelancersCount,
      freelancersCount: activeFreelancersCount,
      editors: activeFreelancersCount === 0 ? "0 active editors" : `${activeFreelancersCount} active editor${activeFreelancersCount === 1 ? "" : "s"}`,
      teamMembers,
      editorInitials,

      status: profile.hiringStatus || "Selective hiring",

      // Website links & profiles
      website,
      websiteUrl: website,
      websiteLink: website,
      agencyStudioUrl,
      publicProfileUrl,

      whatsappNumber: profile.whatsappNumber || null,
      contactEmail: profile.contactEmail || null,
      logoUrl: absoluteAssetUrl(profile.logoUrl, request) || getAgencyFallbackLogo(profile.publicName),
      coverUrl: absoluteAssetUrl(profile.coverUrl, request) || getAgencyFallbackCover(profile.slug),
      rawLogoUrl: profile.logoUrl || null,
      rawCoverUrl: profile.coverUrl || null,
      hasCustomLogo: Boolean(profile.logoUrl),
      hasCustomCover: Boolean(profile.coverUrl),
      stats: {
        averageRating: profile.stats.averageRating || 5,
        reviewCount: profile.stats.reviewCount || 0,
        completedOrders: profile.stats.completedOrders || 0,
        activeEditors: activeFreelancersCount,
      },
    };
  });

  let filteredAgencies = agencies;
  if (filterCity) {
    filteredAgencies = filteredAgencies.filter(
      (a) => a.city.toLowerCase().includes(filterCity) || a.location.toLowerCase().includes(filterCity),
    );
  }
  if (filterSpecialty) {
    filteredAgencies = filteredAgencies.filter(
      (a) => a.specialty.toLowerCase().includes(filterSpecialty) || a.tagline.toLowerCase().includes(filterSpecialty),
    );
  }
  if (searchQuery) {
    filteredAgencies = filteredAgencies.filter(
      (a) =>
        a.name.toLowerCase().includes(searchQuery) ||
        a.specialty.toLowerCase().includes(searchQuery) ||
        a.location.toLowerCase().includes(searchQuery) ||
        a.tagline.toLowerCase().includes(searchQuery),
    );
  }

  const paginatedAgencies = filteredAgencies.slice(0, limit);

  return NextResponse.json(
    {
      ok: true,
      count: paginatedAgencies.length,
      total: filteredAgencies.length,
      source: "registered-agencies-live",
      agencies: paginatedAgencies,
    },
    {
      headers: {
        ...corsHeaders,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
