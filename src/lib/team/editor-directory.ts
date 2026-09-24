import "server-only";

import { prisma } from "@/lib/prisma";

function isPublicMediaUrl(value: string) {
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


type JsonRecord = Record<string, unknown>;

const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "REVISION_REQUESTED"];
const INACTIVE_CONVERSATION_STATUSES = ["CLOSED", "COMPLETED", "ARCHIVED"];

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

function increment(map: Map<string, number>, key: string | null) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function membershipSummary(membership: { id: string; status: string; updatedAt: Date } | null) {
  return membership
    ? {
        id: membership.id,
        status: membership.status,
        assignmentEligible: membership.status === "ACTIVE",
        updatedAt: membership.updatedAt.toISOString(),
      }
    : null;
}

export async function loadActiveEditorDirectory(tenantId: string) {
  // WordPress imports have packageStatus=null and marketplace services owned by
  // legacy User IDs. The app directory deliberately uses only current,
  // non-seeded freelancer accounts with explicitly active access.
  const users = await prisma.appAuthUser.findMany({
    where: {
      packageStatus: "ACTIVE",
      OR: [{ role: "FREELANCER" }, { assignedRole: "FREELANCER" }],
    },
    include: { freelancerWorkspace: true, freelancerTrustSnapshot: true },
    orderBy: [{ lastLoginAt: "desc" }, { createdAt: "desc" }],
  });
  const editorIds = users.map((user) => user.id);
  const userPhones = users.map((u) => u.phone).filter((p): p is string => Boolean(p));
  const userEmails = users.map((u) => u.email).filter((e): e is string => Boolean(e));
  const [services, memberships, teamRequests, portfolioReviews, assignments, conversations] = await Promise.all([
    editorIds.length
      ? prisma.appFreelancerService.findMany({
          where: { ownerId: { in: editorIds }, status: { in: ["APPROVED", "PUBLISHED"] } },
          orderBy: { updatedAt: "desc" },
        })
      : [],
    editorIds.length
      ? prisma.appTeamMembership.findMany({ where: { tenantId, freelancerId: { in: editorIds } }, orderBy: { updatedAt: "desc" } })
      : [],
    editorIds.length
      ? prisma.appTeamRequest.findMany({
          where: { tenantId, freelancerId: { in: editorIds }, status: { in: ["SENT", "PENDING"] } },
          orderBy: { updatedAt: "desc" },
        })
      : [],
    editorIds.length
      ? prisma.appFreelancerPortfolioReview.findMany({
          where: { freelancerId: { in: [...editorIds, ...userPhones, ...userEmails] }, status: { in: ["APPROVED", "PENDING", "CHANGES_REQUESTED"] } },
          orderBy: { submittedAt: "desc" },
        })
      : [],
    editorIds.length
      ? prisma.appAssignmentRecord.findMany({
          where: { freelancerId: { in: editorIds }, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
          select: { freelancerId: true },
        })
      : [],
    editorIds.length
      ? prisma.appConversation.findMany({
          where: { assignedFreelancerId: { in: editorIds }, status: { notIn: INACTIVE_CONVERSATION_STATUSES } },
          select: { assignedFreelancerId: true },
        })
      : [],
  ]);

  const servicesByEditor = new Map<string, typeof services>();
  for (const service of services) {
    const existing = servicesByEditor.get(service.ownerId) ?? [];
    existing.push(service);
    servicesByEditor.set(service.ownerId, existing);
  }
  const membershipsByEditor = new Map<string, (typeof memberships)[number]>();
  for (const membership of memberships) {
    if (!membershipsByEditor.has(membership.freelancerId)) membershipsByEditor.set(membership.freelancerId, membership);
  }
  const reviewsByEditor = new Map<string, (typeof portfolioReviews)[number]>();
  for (const review of portfolioReviews) {
    if (!reviewsByEditor.has(review.freelancerId)) reviewsByEditor.set(review.freelancerId, review);
  }
  const activeProjectsByEditor = new Map<string, number>();
  for (const assignment of assignments) increment(activeProjectsByEditor, assignment.freelancerId);
  const activeChatsByEditor = new Map<string, number>();
  for (const conversation of conversations) increment(activeChatsByEditor, conversation.assignedFreelancerId);
  const requestsByEditor = new Map<string, (typeof teamRequests)[number]>();
  for (const request of teamRequests) {
    if (!requestsByEditor.has(request.freelancerId)) requestsByEditor.set(request.freelancerId, request);
  }

  const editors = users.map((user) => {
    const profile = record(user.freelancerWorkspace?.profile);
    const editorServices = servicesByEditor.get(user.id) ?? [];
    const membership = membershipsByEditor.get(user.id) ?? null;
    const teamRequest = requestsByEditor.get(user.id) ?? null;
    const latestApprovedReview = reviewsByEditor.get(user.id) ?? (user.phone ? reviewsByEditor.get(user.phone) : null) ?? (user.email ? reviewsByEditor.get(user.email) : null) ?? null;
    const publicServices = editorServices.map((service) => {
      const payload = record(service.payload);
      const mediaList = Array.isArray(payload.media) ? payload.media : [];
      const firstMedia = mediaList[0] && typeof mediaList[0] === "object" ? (mediaList[0] as Record<string, unknown>) : null;
      const mediaSource = text(firstMedia?.sourceUrl) || text(firstMedia?.embedUrl);

      return {
        id: service.id,
        slug: service.slug,
        title: text(payload.title) || "Editing service",
        category: text(payload.category) || text(payload.specialty) || "Creative services",
        price: number(payload.basePrice),
        deliveryTime: text(payload.deliveryTime) || null,
        portfolioUrl: text(payload.sampleVideoUrl) || text(payload.sampleVideoEmbedUrl) || mediaSource || null,
      };
    });
    const servicePrices = publicServices.map((service) => service.price).filter((price): price is number => price !== null && price > 0);
    const approvedPortfolioLinks = [
      latestApprovedReview?.portfolioUrl,
      ...publicServices.map((service) => service.portfolioUrl),
      ...list(profile.portfolioLinks),
      ...extractUrlsFromText(text(profile.bio)),
    ].filter((url): url is string => Boolean(url && isPublicMediaUrl(url)));
    const explicitPresence = text(profile.presenceMode).toUpperCase();
    const recentlyActive = Boolean(user.lastLoginAt && user.lastLoginAt.getTime() >= Date.now() - 15 * 60 * 1000);
    const isOnline = explicitPresence === "OFFLINE" ? false : explicitPresence === "ONLINE" ? true : recentlyActive;
    const activeMembership = membership?.status === "ACTIVE" ? membership : null;
    const requestMetadata = record(teamRequest?.metadata);
    const pendingInvitation = teamRequest
      ? {
          id: teamRequest.id,
          status: teamRequest.status,
          updatedAt: teamRequest.updatedAt.toISOString(),
          direction: requestMetadata.initiatedBy === "FREELANCER" ? "FREELANCER_TO_AGENCY" : "AGENCY_TO_FREELANCER",
        }
      : null;

    return {
      id: user.id,
      userId: user.id,
      phone: user.phone,
      name: text(profile.displayName) || text(profile.fullName) || user.displayName,
      title: text(profile.profession) || text(profile.niche) || "Freelance editor",
      category: text(profile.niche) || publicServices[0]?.category || "Creative services",
      bio: text(profile.bio) || "This editor is completing their public portfolio.",
      avatarUrl: text(profile.profileImageUrl) || null,
      verificationStatus: text(record(user.freelancerWorkspace?.verification).status) || "NOT_SUBMITTED",
      karmaScore: user.freelancerTrustSnapshot?.score || number(profile.karmaScore) || 85,
      trustScore: user.freelancerTrustSnapshot?.score ?? number(profile.karmaScore) ?? 85,
      trustProvisional: user.freelancerTrustSnapshot?.provisional ?? true,
      trustUpdatedAt: user.freelancerTrustSnapshot?.updatedAt.toISOString() ?? null,
      skills: [...new Set([...list(profile.skills), ...publicServices.map((service) => service.category).filter(Boolean)])],
      workloadBand: text(profile.workloadBand) || text(profile.availability) || "Available",
      workload: {
        activeProjects: activeProjectsByEditor.get(user.id) ?? 0,
        activeChats: activeChatsByEditor.get(user.id) ?? 0,
      },
      isOnline,
      acceptingProjects: typeof profile.acceptingProjects === "boolean" ? profile.acceptingProjects : true,
      presenceUpdatedAt: text(profile.presenceUpdatedAt) || user.lastLoginAt?.toISOString() || null,
      startingPrice: number(profile.startingPrice) ?? (servicePrices.length ? Math.min(...servicePrices) : null),
      deliveryTime: text(profile.deliveryTime) || publicServices[0]?.deliveryTime || null,
      portfolioLinks: [...new Set(approvedPortfolioLinks)],
      services: publicServices.slice(0, 4),
      membership: membershipSummary(activeMembership),
      invitation: pendingInvitation,
      marketplaceEligible: true,
      offerEligible: true,
      directAssignmentEligible: Boolean(activeMembership),
    };
  });

  const activeMemberships = memberships.filter((membership) => membership.status === "ACTIVE");
  return {
    editors,
    totals: { general: editors.length, active: activeMemberships.length, pending: teamRequests.length },
    invitations: teamRequests.map((request) => ({
      id: request.id,
      editorId: request.freelancerId,
      editorName: request.freelancerName,
      status: request.status,
      direction: record(request.metadata).initiatedBy === "FREELANCER" ? "FREELANCER_TO_AGENCY" : "AGENCY_TO_FREELANCER",
      updatedAt: request.updatedAt.toISOString(),
    })),
  };
}
