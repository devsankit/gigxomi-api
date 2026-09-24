import { isEditorRestrictedForExternalAgency, encodeInHousePermissions, type InHouseEditorSettings } from "@/lib/team/inhouse-editor-policy";
import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { AppRole, SessionUser } from "@/lib/auth/types";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { prisma } from "@/lib/prisma";

export const APP_TEAM_REQUEST_STATUSES = ["SENT", "PENDING", "ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED", "REMOVED"] as const;
export type AppTeamRequestStatus = (typeof APP_TEAM_REQUEST_STATUSES)[number];

export const APP_TEAM_MEMBERSHIP_STATUSES = ["ACTIVE", "SUSPENDED", "REMOVED"] as const;
export type AppTeamMembershipStatus = (typeof APP_TEAM_MEMBERSHIP_STATUSES)[number];

const DEFAULT_REQUEST_DAYS = 14;

type AuthorizedActor = Omit<SessionUser, "expiresAt" | "sessionId"> & Pick<SessionUser, "expiresAt" | "sessionId">;

function makeId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function normalizePermissionList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return Array.from(
    new Set(
      value
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 20),
    ),
  );
}

function sanitizeText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function isTenantOperator(role: AppRole) {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "MANAGER";
}

function canManageTenant(actor: AuthorizedActor, tenantId: string) {
  if (actor.role === "SUPER_ADMIN") {
    return true;
  }

  return isTenantOperator(actor.role) && Boolean(actor.tenantId) && actor.tenantId === tenantId;
}

async function expireStaleTeamRequests(now = new Date()) {
  await prisma.appTeamRequest.updateMany({
    where: {
      status: { in: ["SENT", "PENDING"] },
      expiresAt: { not: null, lt: now },
    },
    data: {
      status: "EXPIRED",
      updatedAt: now,
    },
  });
}

import { listFreelancerServices, listPublicServices } from "@/lib/gigxomi/dummy-platform-store";
import { listPortfolioDrafts } from "@/lib/gigxomi/delivery-portfolio-store";

export type EnrichedFreelancerPortfolioItem = {
  id: string;
  title: string;
  videoUrl?: string;
  embedUrl?: string;
  category?: string;
  description?: string;
};

export type EnrichedFreelancerProfile = {
  id: string;
  displayName: string;
  phone: string;
  email: string | null;
  avatarUrl: string;
  bio: string;
  profession: string;
  languages: string[];
  skills: string[];
  portfolioLinks: string[];
  sampleVideoUrl: string | null;
  sampleVideoEmbedUrl: string | null;
  trustScore: number;
  rating: number;
  reviewsCount: number;
  completedProjects: number;
  responseSlaLabel: string;
  isOnline: boolean;
  services: Array<{
    id: string;
    title: string;
    description: string;
    price: number;
    turnaroundHours: number;
    sampleVideoUrl?: string;
    sampleVideoEmbedUrl?: string;
  }>;
  portfolioItems: EnrichedFreelancerPortfolioItem[];
  isTeamMember?: boolean;
  hasPendingRequest?: boolean;
  requestId?: string | null;
};

const SEEDED_SHOWREELS = [
  "https://www.gigxomi.com/videos/gapp/testimonial-edits-1.mp4",
  "https://www.gigxomi.com/videos/gapp/testimonial-edits-4.mp4",
  "https://www.gigxomi.com/videos/gapp/testimonial-edits-5.mp4",
  "https://www.gigxomi.com/videos/gapp/testimonial-edits-6.mp4",
];

async function enrichFreelancersForAgency(
  tenantId: string,
  requests: Array<{ id: string; freelancerId: string; status: string; freelancerName?: string | null }>,
  memberships: Array<{ id: string; freelancerId: string; status: string; freelancerName?: string | null }>,
): Promise<EnrichedFreelancerProfile[]> {
  const freelancerUsers = await prisma.appAuthUser.findMany({
    where: {
      OR: [{ role: "FREELANCER" }, { assignedRole: "FREELANCER" }],
    },
    select: {
      id: true,
      displayName: true,
      phone: true,
      email: true,
      role: true,
      assignedRole: true,
      createdAt: true,
    },
  });

  const allFreelancers = [...freelancerUsers];
  if (!allFreelancers.some((u) => u.displayName?.toLowerCase().includes("testing freelancer"))) {
    allFreelancers.push({
      id: "editor-testingfreelancer",
      displayName: "Testing Freelancer",
      phone: "+918839048904",
      email: "freelancer@gigxomi.local",
      role: "FREELANCER" as const,
      assignedRole: "FREELANCER" as const,
      createdAt: new Date(),
    });
  }

  const workspaces = await prisma.appFreelancerWorkspace.findMany({
    where: {
      userId: { in: allFreelancers.map((u) => u.id) },
    },
  });
  const workspaceMap = new Map(workspaces.map((w) => [w.userId, w]));

  const allServices = listPublicServices();
  const allPortfolioDrafts = await listPortfolioDrafts();

  const activeMemberFreelancerIds = new Set(
    memberships.filter((m) => m.status === "ACTIVE").map((m) => m.freelancerId),
  );

  const pendingRequestMap = new Map(
    requests.filter((r) => r.status === "SENT" || r.status === "PENDING").map((r) => [r.freelancerId, r.id]),
  );

  return allFreelancers.map((user, index) => {
    const ws = workspaceMap.get(user.id);
    const profile = (ws?.profile as Record<string, unknown>) ?? {};
    const userServices = allServices.filter(
      (s) => s.ownerId === user.id || s.ownerName?.toLowerCase() === user.displayName?.toLowerCase(),
    );
    const userPortfolios = allPortfolioDrafts.filter(
      (p) => p.conversationId === user.id,
    );

    const sampleVideo =
      userServices.find((s) => s.sampleVideoUrl)?.sampleVideoUrl ||
      userPortfolios.find((p) => p.sourceVideoUrl)?.sourceVideoUrl ||
      ((profile.portfolioLinks as string[]) ?? [])[0] ||
      null;

    const sampleEmbed =
      userServices.find((s) => s.sampleVideoEmbedUrl)?.sampleVideoEmbedUrl ||
      userPortfolios.find((p) => p.sourceVideoEmbedUrl)?.sourceVideoEmbedUrl ||
      null;

    const portfolioItems: EnrichedFreelancerPortfolioItem[] =
      userPortfolios.length > 0
        ? userPortfolios.map((p) => ({
            id: p.id,
            title: p.title,
            videoUrl: p.sourceVideoUrl ?? undefined,
            embedUrl: p.sourceVideoEmbedUrl ?? undefined,
            category: p.category || "Video Editing",
            description: p.summary || p.description,
          }))
        : [
            {
              id: `portfolio-${user.id}-1`,
              title: `${user.displayName}'s Video Editing Showreel`,
              videoUrl: sampleVideo ?? undefined,
              embedUrl: sampleEmbed ?? undefined,
              category: "Video Editing",
              description: "Cinematic cuts, reel pacing, transitions, and audio sync showreel.",
            },
          ];

    const isMember = activeMemberFreelancerIds.has(user.id);
    const pendingRequestId = pendingRequestMap.get(user.id) ?? null;

    return {
      id: user.id,
      displayName: user.displayName || "Video Editor",
      phone: user.phone || "",
      email: user.email,
      avatarUrl:
        (profile.profileImageUrl as string) ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || "VE")}&background=E1FF01&color=05070B`,
      bio:
        (profile.bio as string) ||
        "Professional Video Editor specializing in high-converting reels, YouTube long-form, and commercial video edits.",
      profession: (profile.profession as string) || "Video Editor & Reel Specialist",
      languages: (profile.languages as string[]) || ["English", "Hindi"],
      skills: (profile.skills as string[]) || [
        "Premiere Pro",
        "After Effects",
        "DaVinci Resolve",
        "CapCut",
        "Color Grading",
        "Sound Design",
      ],
      portfolioLinks: (profile.portfolioLinks as string[]) || (sampleVideo ? [sampleVideo] : []),
      sampleVideoUrl: sampleVideo,
      sampleVideoEmbedUrl: sampleEmbed,
      trustScore: 92 + (index % 7),
      rating: 4.8 + ((index % 3) * 0.1),
      reviewsCount: 12 + index * 4,
      completedProjects: 8 + index * 3,
      responseSlaLabel: "< 15 min response",
      isOnline: index % 2 === 0,
      services: userServices.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.summary,
        price: s.basePrice,
        turnaroundHours: 24,
        sampleVideoUrl: s.sampleVideoUrl,
        sampleVideoEmbedUrl: s.sampleVideoEmbedUrl,
      })),
      portfolioItems,
      isTeamMember: isMember,
      hasPendingRequest: Boolean(pendingRequestId),
      requestId: pendingRequestId,
    };
  });
}

export async function listTenantTeamRequests(actor: AuthorizedActor, tenantId: string) {
  const normalizedTenantId = tenantId.trim();
  if (!canManageTenant(actor, normalizedTenantId)) {
    return { ok: false as const, status: 403, error: "You do not have access to this agency team." };
  }

  await expireStaleTeamRequests();
  const [requests, memberships] = await Promise.all([
    prisma.appTeamRequest.findMany({
      where: { tenantId: normalizedTenantId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.appTeamMembership.findMany({
      where: { tenantId: normalizedTenantId, status: { not: "REMOVED" } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const availableFreelancers = await enrichFreelancersForAgency(normalizedTenantId, requests, memberships);
  const freelancerMap = new Map(availableFreelancers.map((f) => [f.id, f]));

  const enrichedRequests = requests.map((req) => ({
    ...req,
    freelancer: freelancerMap.get(req.freelancerId) ?? {
      id: req.freelancerId,
      displayName: req.freelancerName || "Video Editor",
      phone: "",
      email: null,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(req.freelancerName || "VE")}&background=E1FF01&color=05070B`,
      bio: "Video editor on Gigxomi network.",
      profession: req.roleType || "Video Editor",
      languages: ["English"],
      skills: ["Video Editing"],
      portfolioLinks: [],
      sampleVideoUrl: null,
      sampleVideoEmbedUrl: null,
      trustScore: 95,
      rating: 4.9,
      reviewsCount: 10,
      completedProjects: 6,
      responseSlaLabel: "< 15 min response",
      isOnline: true,
      services: [],
      portfolioItems: [
        {
          id: `portfolio-${req.freelancerId}-1`,
          title: "Video Editing Showreel",
          videoUrl: undefined,
          category: "Video Editing",
          description: "Video editing and showreel sample.",
        },
      ],
    },
  }));

  const enrichedMemberships = memberships.map((mem) => ({
    ...mem,
    freelancer: freelancerMap.get(mem.freelancerId) ?? {
      id: mem.freelancerId,
      displayName: mem.freelancerName || "Team Editor",
      phone: "",
      email: null,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(mem.freelancerName || "TE")}&background=E1FF01&color=05070B`,
      bio: "Active agency team editor.",
      profession: mem.roleType || "Video Editor",
      languages: ["English"],
      skills: ["Video Editing"],
      portfolioLinks: [],
      sampleVideoUrl: null,
      sampleVideoEmbedUrl: null,
      trustScore: 96,
      rating: 4.9,
      reviewsCount: 15,
      completedProjects: 12,
      responseSlaLabel: "< 15 min response",
      isOnline: true,
      services: [],
      portfolioItems: [
        {
          id: `portfolio-${mem.freelancerId}-1`,
          title: "Video Editing Showreel",
          videoUrl: undefined,
          category: "Video Editing",
          description: "Video editing and showreel sample.",
        },
      ],
    },
  }));

  return {
    ok: true as const,
    requests: enrichedRequests,
    memberships: enrichedMemberships,
    availableFreelancers,
  };
}

export async function listFreelancerTeamRequests(actor: AuthorizedActor) {
  if (actor.role !== "FREELANCER" && actor.role !== "SUPER_ADMIN") {
    return { ok: false as const, status: 403, error: "Only freelancers can view their team requests." };
  }

  await expireStaleTeamRequests();
  const freelancerId = actor.userId;
  const [requests, memberships] = await Promise.all([
    prisma.appTeamRequest.findMany({
      where: actor.role === "SUPER_ADMIN" ? {} : { freelancerId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.appTeamMembership.findMany({
      where: actor.role === "SUPER_ADMIN" ? {} : { freelancerId, status: { not: "REMOVED" } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const availableFreelancers = await enrichFreelancersForAgency("tenant-gigxomi", requests, memberships);
  const myProfile = availableFreelancers.find((f) => f.id === freelancerId);

  return { ok: true as const, requests, memberships, portfolio: myProfile ?? null };
}

export async function createTeamRequest(
  actor: AuthorizedActor,
  tenantId: string,
  input: {
    freelancerId?: unknown;
    message?: unknown;
    offeredTerms?: unknown;
    roleType?: unknown;
    permissions?: unknown;
    expiresAt?: unknown;
    inHouseSettings?: Partial<InHouseEditorSettings>;
  },
) {
  const normalizedTenantId = tenantId.trim();
  if (!canManageTenant(actor, normalizedTenantId)) {
    return { ok: false as const, status: 403, error: "You do not have access to invite freelancers for this agency." };
  }

  const freelancerId = sanitizeText(input.freelancerId);
  if (!freelancerId) {
    return { ok: false as const, status: 400, error: "Choose an editor before sending an agency offer." };
  }

  const freelancer = await prisma.appAuthUser.findUnique({ where: { id: freelancerId } });
  if (!freelancer || (freelancer.role !== "FREELANCER" && freelancer.assignedRole !== "FREELANCER")) {
    return { ok: false as const, status: 404, error: "Freelancer account was not found." };
  }

  if (freelancer.id === actor.userId) {
    return { ok: false as const, status: 400, error: "You cannot send a team request to yourself." };
  }

  const existingMembership = await prisma.appTeamMembership.findUnique({
    where: { tenantId_freelancerId: { tenantId: normalizedTenantId, freelancerId } },
  });
  if (existingMembership?.status === "ACTIVE") {
    return { ok: false as const, status: 409, error: "This freelancer is already active in your agency team." };
  }

  const externalRestriction = await isEditorRestrictedForExternalAgency(freelancerId, normalizedTenantId);
  if (externalRestriction.restricted) {
    return { ok: false as const, status: 409, error: externalRestriction.reason || "This editor is an exclusive in-house team member of another agency and cannot be invited." };
  }

  const activeRequest = await prisma.appTeamRequest.findFirst({
    where: {
      tenantId: normalizedTenantId,
      freelancerId,
      status: { in: ["SENT", "PENDING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (activeRequest) {
    return { ok: true as const, request: activeRequest, duplicate: true };
  }

  const requestedExpiry = sanitizeText(input.expiresAt);
  const expiresAt = requestedExpiry ? new Date(requestedExpiry) : new Date(Date.now() + DEFAULT_REQUEST_DAYS * 24 * 60 * 60 * 1000);
  const safeExpiresAt = Number.isNaN(expiresAt.getTime()) ? new Date(Date.now() + DEFAULT_REQUEST_DAYS * 24 * 60 * 60 * 1000) : expiresAt;
  const agencyOwner = await prisma.appAuthUser.findFirst({
    where: { tenantId: normalizedTenantId, OR: [{ role: "ADMIN" }, { assignedRole: "ADMIN" }] },
    orderBy: { createdAt: "asc" },
    select: { displayName: true },
  });
  const agencyName = agencyOwner?.displayName || actor.displayName || "Agency workspace";
  const roleType = sanitizeText(input.roleType, "Video editor") || "Video editor";
  const message = sanitizeText(input.message, `${agencyName} sent you an offer to join their Gigxomi team.`);
  const offeredTerms = sanitizeText(input.offeredTerms);
  const inHousePerms = input.inHouseSettings ? encodeInHousePermissions(input.inHouseSettings) : [];
  const permissions = Array.from(new Set([...normalizePermissionList(input.permissions), ...inHousePerms]));

  const request = await prisma.appTeamRequest.create({
    data: {
      id: makeId("team-request"),
      tenantId: normalizedTenantId,
      agencyUserId: actor.userId,
      agencyName,
      freelancerId,
      freelancerName: freelancer.displayName,
      roleType,
      message,
      offeredTerms,
      permissions,
      status: "PENDING",
      expiresAt: safeExpiresAt,
      metadata: {
        createdByRole: actor.role,
        createdByUserId: actor.userId,
        createdByName: actor.displayName,
        ...(input.inHouseSettings ? { inHouseSettings: input.inHouseSettings } : {}),
      } satisfies Prisma.InputJsonObject,
    },
  });

  await createAppNotification({
    userId: freelancer.id,
    tenantId: normalizedTenantId,
    type: "team_request_sent",
    title: "New agency offer",
    message: `${agencyName} sent you an offer for ${roleType}. Accept to join their Team.`,
    entityType: "team_request",
    entityId: request.id,
  });

  return { ok: true as const, request, duplicate: false };
}

export async function cancelTeamRequest(actor: AuthorizedActor, requestId: string) {
  const normalizedRequestId = requestId.trim();
  if (!normalizedRequestId) {
    return { ok: false as const, status: 400, error: "Team request id is required." };
  }

  const request = await prisma.appTeamRequest.findUnique({ where: { id: normalizedRequestId } });
  if (!request) {
    return { ok: false as const, status: 404, error: "Team request was not found." };
  }

  if (!canManageTenant(actor, request.tenantId)) {
    return { ok: false as const, status: 403, error: "You do not have access to cancel this team request." };
  }

  if (request.status !== "SENT" && request.status !== "PENDING") {
    return { ok: false as const, status: 409, error: `Cannot cancel team request in ${request.status.toLowerCase()} state.` };
  }

  const updated = await prisma.appTeamRequest.update({
    where: { id: request.id },
    data: {
      status: "CANCELLED",
      respondedAt: new Date(),
      metadata: {
        ...((request.metadata as Prisma.JsonObject) ?? {}),
        cancelledByUserId: actor.userId,
        cancelledAt: new Date().toISOString(),
      },
    },
  });

  return { ok: true as const, request: updated };
}

export async function respondToTeamRequest(
  actor: AuthorizedActor,
  requestId: string,
  input: {
    action?: unknown;
    note?: unknown;
  },
) {
  const normalizedRequestId = requestId.trim();
  if (!normalizedRequestId) {
    return { ok: false as const, status: 400, error: "Team request id is required." };
  }

  const request = await prisma.appTeamRequest.findUnique({ where: { id: normalizedRequestId } });
  if (!request) {
    return { ok: false as const, status: 404, error: "Team request was not found." };
  }

  const requestMetadata = request.metadata && typeof request.metadata === "object" && !Array.isArray(request.metadata) ? request.metadata as Prisma.JsonObject : {};
  const initiatedByFreelancer = requestMetadata.initiatedBy === "FREELANCER";
  const canRespond =
    actor.role === "SUPER_ADMIN" ||
    (initiatedByFreelancer && actor.role === "ADMIN" && request.agencyUserId === actor.userId) ||
    (!initiatedByFreelancer && actor.role === "FREELANCER" && request.freelancerId === actor.userId);
  if (!canRespond) {
    return { ok: false as const, status: 403, error: "You do not have access to this team request." };
  }

  await expireStaleTeamRequests();
  const freshRequest = await prisma.appTeamRequest.findUnique({ where: { id: normalizedRequestId } });
  if (!freshRequest || !["SENT", "PENDING"].includes(freshRequest.status)) {
    return { ok: false as const, status: 409, error: "This team request is no longer pending." };
  }

  const action = sanitizeText(input.action).toUpperCase();
  if (action !== "ACCEPT" && action !== "REJECT") {
    return { ok: false as const, status: 400, error: "Choose accept or reject." };
  }

  if (action === "ACCEPT") {
    const externalRestriction = await isEditorRestrictedForExternalAgency(freshRequest.freelancerId, freshRequest.tenantId);
    if (externalRestriction.restricted) {
      return { ok: false as const, status: 409, error: externalRestriction.reason || "This editor is exclusively contracted with another agency and cannot join." };
    }
  }

  const respondedAt = new Date();
  if (action === "REJECT") {
    const updated = await prisma.appTeamRequest.update({
      where: { id: freshRequest.id },
      data: {
        status: "REJECTED",
        respondedAt,
        metadata: {
          ...((freshRequest.metadata as Prisma.JsonObject) ?? {}),
          responseNote: sanitizeText(input.note),
          respondedByUserId: actor.userId,
        },
      },
    });
    await createAppNotification({
      userId: initiatedByFreelancer ? freshRequest.freelancerId : freshRequest.agencyUserId,
      tenantId: freshRequest.tenantId,
      type: "team_request_rejected",
      title: "Team request rejected",
      message: initiatedByFreelancer ? `${freshRequest.agencyName} declined the agency application.` : `${freshRequest.freelancerName} rejected the team request.`,
      entityType: "team_request",
      entityId: updated.id,
    });
    return { ok: true as const, request: updated, membership: null };
  }

  const [updatedRequest, membership] = await prisma.$transaction([
    prisma.appTeamRequest.update({
      where: { id: freshRequest.id },
      data: {
        status: "ACCEPTED",
        respondedAt,
        metadata: {
          ...((freshRequest.metadata as Prisma.JsonObject) ?? {}),
          responseNote: sanitizeText(input.note),
          respondedByUserId: actor.userId,
        },
      },
    }),
    prisma.appTeamMembership.upsert({
      where: {
        tenantId_freelancerId: {
          tenantId: freshRequest.tenantId,
          freelancerId: freshRequest.freelancerId,
        },
      },
      create: {
        id: makeId("team-member"),
        tenantId: freshRequest.tenantId,
        agencyUserId: freshRequest.agencyUserId,
        agencyName: freshRequest.agencyName,
        freelancerId: freshRequest.freelancerId,
        freelancerName: freshRequest.freelancerName,
        roleType: freshRequest.roleType,
        permissions: freshRequest.permissions,
        status: "ACTIVE",
        acceptedRequestId: freshRequest.id,
        metadata: {
          acceptedByUserId: actor.userId,
          acceptedAt: respondedAt.toISOString(),
          ...(((freshRequest.metadata as Prisma.JsonObject)?.inHouseSettings) ? { inHouseSettings: (freshRequest.metadata as Prisma.JsonObject).inHouseSettings } : {}),
        } satisfies Prisma.InputJsonObject,
      },
      update: {
        agencyUserId: freshRequest.agencyUserId,
        agencyName: freshRequest.agencyName,
        freelancerName: freshRequest.freelancerName,
        roleType: freshRequest.roleType,
        permissions: freshRequest.permissions,
        status: "ACTIVE",
        acceptedRequestId: freshRequest.id,
        removedAt: null,
        metadata: {
          acceptedByUserId: actor.userId,
          acceptedAt: respondedAt.toISOString(),
          ...(((freshRequest.metadata as Prisma.JsonObject)?.inHouseSettings) ? { inHouseSettings: (freshRequest.metadata as Prisma.JsonObject).inHouseSettings } : {}),
        } satisfies Prisma.InputJsonObject,
      },
    }),
  ]);

  await createAppNotification({
    userId: initiatedByFreelancer ? freshRequest.freelancerId : freshRequest.agencyUserId,
    tenantId: freshRequest.tenantId,
    type: "team_request_accepted",
    title: initiatedByFreelancer ? "Agency application accepted" : "Freelancer joined your team",
    message: initiatedByFreelancer ? `${freshRequest.agencyName} accepted your application.` : `${freshRequest.freelancerName} accepted the team request.`,
    entityType: "team_membership",
    entityId: membership.id,
  });

  return { ok: true as const, request: updatedRequest, membership };
}
