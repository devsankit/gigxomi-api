import "server-only";

import { prisma } from "@/lib/prisma";

export type VideoOrientation = "portrait" | "landscape" | "square";
export type VideoAspectRatio = "9:16" | "16:9" | "1:1";

export interface TeamPortfolioItemDto {
  id: string;
  title: string;
  category: string;
  orientation: VideoOrientation;
  aspectRatio: VideoAspectRatio;
  videoUrl: string;
  embedUrl: string;
  thumbnailUrl: string;
  tags: string[];
  description: string;
}

export interface TeamMemberPortfolioDto {
  id: string;
  displayName: string;
  role: string;
  avatarUrl: string;
  profession: string;
  bio: string;
  skills: string[];
  portfolioItems: TeamPortfolioItemDto[];
}

export interface TeamPortfolioQueryFilters {
  status?: string;
  category?: string;
  orientation?: VideoOrientation;
  memberId?: string;
  limit?: number;
  cursor?: string;
}

export interface TeamPortfolioResponseData {
  agency: {
    id: string;
    name: string;
    slug: string;
  };
  teamMembers: TeamMemberPortfolioDto[];
  pagination: {
    limit: number;
    cursor: string | null;
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
  };
  updatedAt: string;
}

function parseRecord(val: unknown): Record<string, unknown> {
  return val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : {};
}

function cleanText(val: unknown, fallback = ""): string {
  return typeof val === "string" ? val.trim() : fallback;
}

function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace(/^\//, "").split("/")[0] || null;
    }
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/shorts/")[1]?.split("/")[0]?.split("?")[0] || null;
      }
      return parsed.searchParams.get("v") || null;
    }
  } catch {
    // Ignore invalid URLs
  }
  return null;
}

function determineOrientationAndEmbed(url: string, rawPayload: Record<string, unknown>): {
  orientation: VideoOrientation;
  aspectRatio: VideoAspectRatio;
  embedUrl: string;
  thumbnailUrl: string;
} {
  const ytId = extractYouTubeId(url);
  const isShorts = url.toLowerCase().includes("/shorts/");
  const explicitRatio = String(rawPayload.aspectRatio || rawPayload.ratio || "").trim();
  const title = String(rawPayload.title || "").toLowerCase();
  const category = String(rawPayload.category || "").toLowerCase();

  const isVertical =
    isShorts ||
    explicitRatio === "9:16" ||
    title.includes("reel") ||
    title.includes("short") ||
    title.includes("tiktok") ||
    category.includes("reel") ||
    category.includes("short");

  const isSquare = explicitRatio === "1:1" || title.includes("square");

  let orientation: VideoOrientation = "landscape";
  let aspectRatio: VideoAspectRatio = "16:9";

  if (isVertical) {
    orientation = "portrait";
    aspectRatio = "9:16";
  } else if (isSquare) {
    orientation = "square";
    aspectRatio = "1:1";
  }

  let embedUrl = url;
  let thumbnailUrl = cleanText(
    rawPayload.thumbnailUrl || rawPayload.coverUrl || rawPayload.posterUrl || rawPayload.previewImageUrl || rawPayload.thumbnail,
  );

  if (ytId) {
    embedUrl = `https://www.youtube-nocookie.com/embed/${ytId}`;
    if (!thumbnailUrl) {
      thumbnailUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    }
  }

  return {
    orientation,
    aspectRatio,
    embedUrl,
    thumbnailUrl,
  };
}

export async function getAgencyTeamPortfolio(
  tenantId: string,
  filters: TeamPortfolioQueryFilters = {},
): Promise<TeamPortfolioResponseData> {
  const cleanTenantId = tenantId.trim();

  // 1. Resolve Agency Details
  const tenant = await (prisma as any).tenant.findUnique({
    where: { id: cleanTenantId },
    select: { id: true, name: true, slug: true, status: true },
  });

  if (!tenant || tenant.status !== "ACTIVE") {
    throw new Error("Agency tenant is inactive or unavailable");
  }

  const agencyName = tenant?.name || "Agency Workspace";
  const agencySlug = tenant?.slug || cleanTenantId;

  // 2. Fetch Active Team Members for this Tenant
  const memberships = await (prisma as any).appTeamMembership.findMany({
    where: {
      tenantId: cleanTenantId,
      status: "ACTIVE",
      ...(filters.memberId ? { freelancerId: filters.memberId.trim() } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  const memberIds = memberships.map((m: any) => m.freelancerId as string);

  if (memberIds.length === 0) {
    return {
      agency: { id: cleanTenantId, name: agencyName, slug: agencySlug },
      teamMembers: [],
      pagination: {
        limit: filters.limit ?? 20,
        cursor: null,
        nextCursor: null,
        hasMore: false,
        total: 0,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  // 3. Fetch Enriched Freelancer Profile Info
  const users = await (prisma as any).appAuthUser.findMany({
    where: { id: { in: memberIds } },
    select: {
      id: true,
      displayName: true,
      freelancerWorkspace: {
        select: {
          profile: true,
        },
      },
    },
  });

  const usersById = new Map<string, any>(users.map((u: any) => [u.id, u]));

  // 4. Fetch Approved Services & Approved Portfolio Reviews
  const [approvedServices, approvedReviews] = await Promise.all([
    (prisma as any).appFreelancerService.findMany({
      where: {
        ownerId: { in: memberIds },
        status: { in: ["APPROVED", "PUBLISHED"] },
      },
      orderBy: { updatedAt: "desc" },
    }),
    (prisma as any).appFreelancerPortfolioReview.findMany({
      where: {
        freelancerId: { in: memberIds },
        status: "APPROVED",
      },
      orderBy: { submittedAt: "desc" },
    }),
  ]);

  const servicesByOwner = new Map<string, any[]>();
  for (const svc of approvedServices) {
    const list = servicesByOwner.get(svc.ownerId) || [];
    list.push(svc);
    servicesByOwner.set(svc.ownerId, list);
  }

  const reviewsByOwner = new Map<string, any[]>();
  for (const rev of approvedReviews) {
    const list = reviewsByOwner.get(rev.freelancerId) || [];
    list.push(rev);
    reviewsByOwner.set(rev.freelancerId, list);
  }

  // 5. Construct Team Member Portfolio DTOs
  const teamMembers: TeamMemberPortfolioDto[] = [];

  for (const membership of memberships) {
    const user = usersById.get(membership.freelancerId);
    const profile = parseRecord(user?.freelancerWorkspace?.profile);
    const membershipMeta = parseRecord(membership.metadata);

    const displayName =
      cleanText(user?.displayName) ||
      cleanText(membership.freelancerName) ||
      cleanText(profile.name) ||
      "Creative Editor";

    const avatarUrl =
      cleanText(profile.avatarUrl) ||
      cleanText(membershipMeta.avatarUrl) ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=101827&color=D7FF2F&bold=true`;

    const profession = cleanText(profile.profession) || cleanText(membership.roleType) || "Video Editor";
    const bio = cleanText(profile.bio) || cleanText(membershipMeta.bio) || "Professional Video Editor specializing in high-engagement video content.";
    const skills = Array.isArray(profile.skills)
      ? profile.skills.map(String).filter(Boolean)
      : ["Premiere Pro", "After Effects", "Color Grading"];

    // Collect portfolio items
    const rawItems: TeamPortfolioItemDto[] = [];
    const seenUrls = new Set<string>();

    // From approved services
    const services = servicesByOwner.get(membership.freelancerId) || [];
    for (const service of services) {
      const payload = parseRecord(service.payload);
      const sampleUrl = cleanText(payload.sampleVideoUrl || payload.previewVideoUrl || payload.videoUrl);

      if (sampleUrl && !seenUrls.has(sampleUrl.toLowerCase())) {
        seenUrls.add(sampleUrl.toLowerCase());
        const { orientation, aspectRatio, embedUrl, thumbnailUrl } = determineOrientationAndEmbed(sampleUrl, payload);

        rawItems.push({
          id: `svc-${service.id}`,
          title: cleanText(payload.title) || cleanText(service.slug) || "Showcase Reel",
          category: cleanText(payload.category) || "Video Editing",
          orientation,
          aspectRatio,
          videoUrl: sampleUrl,
          embedUrl,
          thumbnailUrl: thumbnailUrl || avatarUrl,
          tags: Array.isArray(payload.tags) ? payload.tags.map(String).filter(Boolean) : [],
          description: cleanText(payload.description) || cleanText(payload.brief) || "",
        });
      }
    }

    // From approved portfolio reviews
    const reviews = reviewsByOwner.get(membership.freelancerId) || [];
    for (const review of reviews) {
      const pUrl = cleanText(review.portfolioUrl);
      if (pUrl && !seenUrls.has(pUrl.toLowerCase())) {
        seenUrls.add(pUrl.toLowerCase());
        const { orientation, aspectRatio, embedUrl, thumbnailUrl } = determineOrientationAndEmbed(pUrl, {
          title: "Approved Portfolio Reel",
        });

        rawItems.push({
          id: `rev-${review.id}`,
          title: "Approved Portfolio Showcase",
          category: "Portfolio Reel",
          orientation,
          aspectRatio,
          videoUrl: pUrl,
          embedUrl,
          thumbnailUrl: thumbnailUrl || avatarUrl,
          tags: ["Portfolio", "Verified"],
          description: cleanText(review.note) || "Verified editor portfolio submission.",
        });
      }
    }

    // Apply filtering to portfolio items
    const filteredItems = rawItems.filter((item) => {
      if (filters.orientation && item.orientation !== filters.orientation) {
        return false;
      }
      if (filters.category) {
        const catQuery = filters.category.toLowerCase().trim();
        const matchesCategory = item.category.toLowerCase().includes(catQuery);
        const matchesTags = item.tags.some((t) => t.toLowerCase().includes(catQuery));
        const matchesTitle = item.title.toLowerCase().includes(catQuery);
        if (!matchesCategory && !matchesTags && !matchesTitle) {
          return false;
        }
      }
      return true;
    });

    // Only include team members if they have matching items, or if no category/orientation filter was requested
    if (filteredItems.length > 0 || (!filters.category && !filters.orientation)) {
      teamMembers.push({
        id: membership.freelancerId,
        displayName,
        role: cleanText(membership.roleType) || "Team Editor",
        avatarUrl,
        profession,
        bio,
        skills,
        portfolioItems: filteredItems,
      });
    }
  }

  // 6. Pagination
  const limit = Math.max(1, Math.min(100, Number(filters.limit) || 20));
  const offset = filters.cursor ? Math.max(0, Number.parseInt(filters.cursor, 10) || 0) : 0;
  const paginatedMembers = teamMembers.slice(offset, offset + limit);
  const nextOffset = offset + limit < teamMembers.length ? String(offset + limit) : null;

  return {
    agency: {
      id: cleanTenantId,
      name: agencyName,
      slug: agencySlug,
    },
    teamMembers: paginatedMembers,
    pagination: {
      limit,
      cursor: filters.cursor || null,
      nextCursor: nextOffset,
      hasMore: nextOffset !== null,
      total: teamMembers.length,
    },
    updatedAt: new Date().toISOString(),
  };
}
