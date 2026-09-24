import { parseInHouseSettings } from "@/lib/team/inhouse-editor-policy";
import "server-only";
import { prisma } from "@/lib/prisma";
import { parseMediaUrls, isYouTubeOrInstagramUrl } from "@/lib/gigxomi/media";

// Only public media URLs leave the directory. Never expose arbitrary schemes or credentials.
export function isPublicMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}
function extractUrlsFromText(raw?: string | null): string[] {
  if (!raw || typeof raw !== "string") return [];
  const matches = raw.match(/https?:\/\/[^\s"',<>)]+/g);
  return matches ? Array.from(new Set(matches.map((u) => u.trim()).filter(isPublicMediaUrl))) : [];
}

function publicMediaUrl(value: string) {
  return isPublicMediaUrl(value) ? value : null;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function membershipSummary(membership: {
  id: string;
  status: string;
  updatedAt: Date;
} | null) {
  return membership
    ? {
        id: membership.id,
        status: membership.status,
        assignmentEligible: membership.status === "ACTIVE",
        updatedAt: membership.updatedAt.toISOString(),
      }
    : null;
}

export async function loadEditors(tenantId: string, editorId?: string) {
  const users = await prisma.appAuthUser.findMany({
    where: {
      ...(editorId
        ? {
            OR: [
              { id: editorId },
              { phone: editorId },
              { email: editorId },
            ],
          }
        : {
            OR: [
              { role: "FREELANCER" },
              { assignedRole: "FREELANCER" },
              { packageAudience: "FREELANCER" },
              { workspaceMode: "FREELANCER" },
            ],
          }),
    },
    select: {
      id: true,
      displayName: true,
      email: true,
      phone: true,
      role: true,
      packageStatus: true,
      packageExpiresAt: true,
      lastLoginAt: true,
      freelancerWorkspace: { select: { profile: true, verification: true } },
      freelancerTrustSnapshot: { select: { score: true, provisional: true, calculatedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const editorIds = users.map((user) => user.id);
  const [services, memberships, allActiveMemberships, pendingRequests, projects, chats, editorProfiles, portfolioReviews] = await Promise.all([
    editorIds.length
      ? prisma.appFreelancerService.findMany({
          where: { ownerId: { in: editorIds } },
          orderBy: { updatedAt: "desc" },
        })
      : [],
    editorIds.length
      ? prisma.appTeamMembership.findMany({ where: { tenantId, freelancerId: { in: editorIds } } })
      : [],
    editorIds.length
      ? prisma.appTeamMembership.findMany({ where: { freelancerId: { in: editorIds }, status: "ACTIVE" } })
      : [],
    prisma.appTeamRequest.findMany({
      where: {
        tenantId,
        freelancerId: { in: editorIds },
        status: { in: ["SENT", "PENDING"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, freelancerId: true, freelancerName: true, roleType: true, status: true, updatedAt: true, metadata: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.appAssignmentRecord.groupBy({
      by: ["freelancerId"],
      where: {
        freelancerId: { in: editorIds },
        status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "REVISION_REQUESTED"] },
      },
      _count: { _all: true },
    }),
    prisma.appConversation.groupBy({
      by: ["assignedFreelancerId"],
      where: { assignedFreelancerId: { in: editorIds }, status: { notIn: ["closed", "CLOSED"] } },
      _count: { _all: true },
    }),
    editorIds.length
      ? prisma.editorProfile.findMany({
          where: { userId: { in: editorIds } },
          include: {
            services: {
              where: { isActive: true },
              include: { mediaAssets: true },
            },
          },
        }).catch(() => [])
      : [],
    editorIds.length
      ? prisma.appFreelancerPortfolioReview.findMany({
          where: {
            freelancerId: { in: Array.from(new Set([...editorIds, ...users.map(u => u.phone).filter(Boolean) as string[], ...users.map(u => u.email).filter(Boolean) as string[]])) },
            status: { in: ["APPROVED", "PENDING", "CHANGES_REQUESTED"] },
          },
          orderBy: { submittedAt: "desc" },
        }).catch(() => [])
      : [],
  ]);

  const servicesByEditor = new Map<string, typeof services>();
  for (const service of services) {
    const existing = servicesByEditor.get(service.ownerId) ?? [];
    existing.push(service);
    servicesByEditor.set(service.ownerId, existing);
  }
  const membershipsByEditor = new Map(memberships.map((membership) => [membership.freelancerId, membership]));
  const editorProfilesByUserId = new Map(editorProfiles.map((ep) => [ep.userId, ep]));

  const reviewsByEditor = new Map<string, typeof portfolioReviews>();
  for (const review of portfolioReviews) {
    const existing = reviewsByEditor.get(review.freelancerId) ?? [];
    existing.push(review);
    reviewsByEditor.set(review.freelancerId, existing);
  }



  return users.map((user, idx) => {
    const profile = record(user.freelancerWorkspace?.profile);
    const editorProfile = editorProfilesByUserId.get(user.id);
    const editorServices = servicesByEditor.get(user.id) ?? [];
    const legacyServices = editorProfile?.services ?? [];
    const membership = membershipsByEditor.get(user.id) ?? null;
    const pendingRequest = pendingRequests.find((request) => request.freelancerId === user.id && record(request.metadata).requestKind !== "WORK");
    const invitation = pendingRequest
      ? {
          id: pendingRequest.id,
          status: "INVITED",
          updatedAt: pendingRequest.updatedAt.toISOString(),
          direction:
            record(pendingRequest.metadata).initiatedBy === "FREELANCER" || record(pendingRequest.metadata).direction === "FREELANCER_TO_AGENCY"
              ? "FREELANCER_TO_AGENCY"
              : "AGENCY_TO_FREELANCER",
        }
      : null;

    

    // Collect portfolio review URLs (prioritize approved, then submitted)
    const rawUserReviews = [
      ...(reviewsByEditor.get(user.id) ?? []),
      ...(user.phone ? reviewsByEditor.get(user.phone) ?? [] : []),
    ];
    const userReviews = Array.from(new Map(rawUserReviews.map((r) => [r.id, r])).values());
    const approvedReviews = userReviews.filter((r) => r.status === "APPROVED");
    const primaryReviews = approvedReviews.length > 0 ? approvedReviews : userReviews;
    const reviewUrls = primaryReviews.flatMap((r) => parseMediaUrls(r.portfolioUrl));

    const publishedServices = editorServices.filter((service) => ["APPROVED", "PUBLISHED"].includes(service.status.toUpperCase()));
    const nativePublicServices = (publishedServices.length > 0 ? publishedServices : editorServices).map((service) => {
      const payload = record(service.payload);
      const mediaList = Array.isArray(payload.media) ? payload.media : [];
      const firstMedia = mediaList[0] && typeof mediaList[0] === "object" ? (mediaList[0] as Record<string, unknown>) : null;
      const mediaSource = text(firstMedia?.sourceUrl) || text(firstMedia?.embedUrl);
      const video =
        text(payload.sampleVideoUrl) ||
        text(payload.sampleVideoEmbedUrl) ||
        text(payload.videoUrl) ||
        mediaSource ||
        (Array.isArray(payload.portfolioUrls) ? text(payload.portfolioUrls[0]) : "");
      return {
        id: service.id,
        slug: service.slug,
        title: text(payload.title) || "Video Editing Service",
        category: text(payload.category) || text(payload.specialty) || "Video Editing",
        price: number(payload.basePrice) ?? 499,
        deliveryTime: text(payload.deliveryTime) || "2 Days",
        portfolioUrl: publicMediaUrl(video) || reviewUrls[0] || null,
      };
    });

    const legacyPublicServices = legacyServices.map((s) => {
      const media =
        s.mediaAssets?.[0]?.sourceUrl ||
        s.mediaAssets?.[0]?.deliveryUrl ||
        (s.sourceUrl && (s.sourceUrl.includes("youtube.com") || s.sourceUrl.includes("youtu.be") || s.sourceUrl.includes("vimeo.com"))
          ? s.sourceUrl
          : null);
      return {
        id: s.id,
        slug: s.slug,
        title: s.title || "Video Editing Service",
        category: s.category || "Video Editing",
        price: s.price ? Number(s.price) : 499,
        deliveryTime: s.deliveryTime || "2 Days",
        portfolioUrl: publicMediaUrl(media || "") || reviewUrls[0] || null,
      };
    });

    const publicServices = [...nativePublicServices, ...legacyPublicServices];
    const servicePrices = publicServices.map((service) => service.price).filter((price): price is number => price !== null && price > 0);

    const directPortfolio = publicMediaUrl(
      text(profile.portfolioVideoUrl) ||
        text(profile.showreelUrl) ||
        text(profile.portfolioUrl) ||
        text(profile.videoUrl) ||
        editorProfile?.youtubeChannelUrl ||
        ""
    );

    const profilePortfolioList = list(profile.portfolioLinks).map(publicMediaUrl).filter((u): u is string => Boolean(u));

    const bioUrls = extractUrlsFromText(text(profile.bio));

    const allPortfolioLinks = [
      ...new Set([
        ...reviewUrls,
        directPortfolio,
        ...publicServices.map((s) => s.portfolioUrl),
        ...profilePortfolioList,
        ...bioUrls,
      ].filter((url): url is string => Boolean(url && isPublicMediaUrl(url)))),
    ];

    const explicitPresence = text(profile.presenceMode).toUpperCase();
    const recentlyActive = Boolean(user.lastLoginAt && user.lastLoginAt.getTime() >= Date.now() - 30 * 60 * 1000);
    const isOnline = explicitPresence === "OFFLINE" ? false : explicitPresence === "ONLINE" ? true : recentlyActive;

    const basePrice =
      number(profile.startingPrice) ??
      (editorProfile?.startingPrice ? Number(editorProfile.startingPrice) : null) ??
      (servicePrices.length ? Math.min(...servicePrices) : 499);
    const calculatedTrust = user.freelancerTrustSnapshot?.score ?? (user.freelancerWorkspace ? 90 : 85);

    // Strictly prioritize YouTube & Instagram video links for clean playable embeds
    const socialVideoLinks = allPortfolioLinks.filter(isYouTubeOrInstagramUrl);
    const primaryPortfolio = socialVideoLinks[0] || null;

    const hasMarketplaceAccess =
      user.packageStatus !== "PAUSED" &&
      user.packageStatus !== "EXPIRED" &&
      (!user.packageExpiresAt || user.packageExpiresAt > new Date());
    const marketplaceEligible = hasMarketplaceAccess && publicServices.length > 0;

    const externalExclusiveMembership = allActiveMemberships.find(
      (m) => m.freelancerId === user.id && m.tenantId !== tenantId
    );
    let isExternalInHouseRestricted = false;
    if (externalExclusiveMembership) {
      const parsed = parseInHouseSettings(externalExclusiveMembership.permissions, externalExclusiveMembership.metadata);
      if (parsed.exclusiveAgencyOnly || !parsed.marketplaceVisible) {
        isExternalInHouseRestricted = true;
      }
    }

    return {
      id: user.id,
      userId: user.id,
      phone: user.phone,
      isExternalInHouseRestricted,
      inHouseSettings: membership ? parseInHouseSettings(membership.permissions, membership.metadata) : null,
      name: text(profile.displayName) || text(profile.fullName) || user.displayName || "Video Editor",
      title: text(profile.profession) || text(profile.niche) || editorProfile?.title || "Short-form/Reels & YouTube Editor",
      category: text(profile.niche) || editorProfile?.category || publicServices[0]?.category || "Video Editing",
      bio:
        text(profile.bio) ||
        editorProfile?.bio ||
        "Experienced Video Editor specializing in high-retention Reels, Shorts, YouTube edits, and Color Grading.",
      avatarUrl: publicMediaUrl(text(profile.profileImageUrl)) || publicMediaUrl(editorProfile?.avatarUrl || "") || null,
      verificationStatus: text(record(user.freelancerWorkspace?.verification).status) || "VERIFIED",
      karmaScore: number(profile.karmaScore) || calculatedTrust || 90,
      trustScore: calculatedTrust || 90,
      trustProvisional: false,
      trustUpdatedAt: user.freelancerTrustSnapshot?.calculatedAt.toISOString() ?? new Date().toISOString(),
      workload: {
        activeProjects: projects.find((item) => item.freelancerId === user.id)?._count._all ?? 0,
        activeChats: chats.find((item) => item.assignedFreelancerId === user.id)?._count._all ?? 0,
      },
      skills: [
        ...new Set([
          ...list(profile.skills),
          "Premiere Pro",
          "After Effects",
          "CapCut",
          ...publicServices.map((service) => service.category).filter(Boolean),
        ]),
      ],
      workloadBand: text(profile.workloadBand) || text(profile.availability) || "Available now",
      isOnline,
      acceptingProjects: typeof profile.acceptingProjects === "boolean" ? profile.acceptingProjects : true,
      presenceUpdatedAt: text(profile.presenceUpdatedAt) || user.lastLoginAt?.toISOString() || new Date().toISOString(),
      startingPrice: basePrice,
      deliveryTime: text(profile.deliveryTime) || editorProfile?.deliveryTime || publicServices[0]?.deliveryTime || "24-48 Hours",
      portfolioLinks: socialVideoLinks,
      services:
        publicServices.length > 0
          ? publicServices
          : [
              {
                id: `srv-${user.id}-1`,
                slug: "reels-shorts-editing",
                title: "Short-form Reels & Shorts Editing",
                category: "Video Editing",
                price: basePrice,
                deliveryTime: "24 Hours",
                portfolioUrl: primaryPortfolio,
              },
            ],
      membership: membershipSummary(membership),
      invitation,
      marketplaceEligible: true,
      offerEligible: marketplaceEligible || membership?.status === "ACTIVE",
      directAssignmentEligible: membership?.status === "ACTIVE",
    };
  });
}
