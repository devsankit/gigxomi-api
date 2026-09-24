import "server-only";

import type { AppMarketplaceTask, AppTaskApplication, Prisma } from "@prisma/client";

import type { SessionUser } from "@/lib/auth/types";
import {
  createMarketplaceTask,
  createTaskApplication,
  listTasksForActor,
  updateTaskApplicationStatus,
} from "@/lib/gigxomi/app-task-flow-service";
import { createTeamRequest, respondToTeamRequest } from "@/lib/gigxomi/app-team-flow-service";

type Actor = Omit<SessionUser, "expiresAt" | "sessionId"> & Pick<SessionUser, "expiresAt" | "sessionId">;
type JsonRecord = Record<string, unknown>;

function record(value: Prisma.JsonValue | null | undefined): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function list(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function amount(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function applicationStatus(status: string) {
  return status === "APPLIED" ? "PENDING" : status;
}

function postStatus(status: string) {
  if (["ASSIGNED", "IN_PROGRESS", "COMPLETED"].includes(status)) return "FILLED";
  if (["CANCELLED", "APPLICATIONS_CLOSED"].includes(status)) return "CLOSED";
  if (status === "PAUSED") return "PAUSED";
  return "OPEN";
}

function visibility(value: string) {
  if (value === "AGENCY_TEAM") return "AGENCY_TEAM";
  if (value === "INVITED_ONLY") return "PRIVATE_INVITE";
  return "PUBLIC_MATCHED";
}

export function mapMobileApplication(application: AppTaskApplication, task?: AppMarketplaceTask) {
  return {
    applicationId: application.id,
    workPostId: application.taskId,
    agencyId: task?.agencyUserId ?? task?.tenantId ?? application.tenantId,
    editorId: application.freelancerId,
    proposalMessage: application.proposal,
    expectedPayout: application.quotedAmount || null,
    expectedDelivery: application.estimatedTurnaround,
    availability: application.estimatedTurnaround,
    portfolioLinks: application.portfolioReference ? [application.portfolioReference] : [],
    status: applicationStatus(application.status),
    createdAt: application.createdAt.toISOString(),
  };
}

export function mapMobileWorkPost(task: AppMarketplaceTask, applications: AppTaskApplication[] = []) {
  const metadata = record(task.metadata);
  const tags = list(metadata.productionTags);
  const priority = String(metadata.priority ?? "NORMAL").toUpperCase();
  const scope = String(metadata.projectScope ?? "").trim();
  const sampleLink = String(metadata.sampleLink ?? "").trim() || task.referenceLinks[0] || null;
  const matchPercentage = Math.max(72, Math.min(98, 62 + task.requiredSkills.length * 5 + tags.length * 3));

  return {
    id: task.id,
    tenantId: task.tenantId,
    agencyId: task.agencyUserId,
    agencyName: task.agencyName,
    title: task.title,
    description: task.brief,
    category: task.category,
    niche: task.category,
    tags,
    skills: task.requiredSkills,
    budgetMin: task.budgetAmount || null,
    budgetMax: task.budgetAmount || null,
    deadline: task.deadline?.toISOString() ?? null,
    workType: priority === "URGENT" ? "URGENT" : "ONE_TIME",
    experienceLevel: "INTERMEDIATE",
    editorsNeeded: 1,
    expectedOutput: scope,
    sampleLink,
    attachmentLinks: task.referenceLinks,
    status: postStatus(task.status),
    visibility: visibility(task.visibility),
    applications: applications.map((application) => mapMobileApplication(application, task)),
    recommendedEditors: [],
    match: {
      matchPercentage,
      matchedReasons: ["Skill overlap", "Delivery fit", "Marketplace availability"],
      matchedSkills: task.requiredSkills.slice(0, 4),
      matchedTags: tags.slice(0, 4),
      skills: task.requiredSkills,
      experienceLevel: "INTERMEDIATE",
    },
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export async function listMobileWorkMatching(actor: Actor) {
  const result = await listTasksForActor(actor);
  if (!result.ok) return result;

  const applicationsByTask = new Map<string, AppTaskApplication[]>();
  for (const application of result.applications) {
    const rows = applicationsByTask.get(application.taskId) ?? [];
    rows.push(application);
    applicationsByTask.set(application.taskId, rows);
  }

  if (actor.role === "ADMIN" || actor.role === "MANAGER" || actor.role === "SUPER_ADMIN") {
    const workPosts = result.tasks.map((task) => mapMobileWorkPost(task, applicationsByTask.get(task.id) ?? []));
    return {
      ok: true as const,
      payload: {
        ok: true,
        mode: "agency",
        workPosts,
        connections: [],
        totals: {
          openPosts: workPosts.filter((post) => post.status === "OPEN").length,
          pendingApplications: result.applications.filter((item) => ["APPLIED", "SHORTLISTED"].includes(item.status)).length,
          acceptedApplications: result.applications.filter((item) => item.status === "ACCEPTED").length,
          recommendedEditors: 0,
        },
        limits: "limits" in result ? result.limits : null,
      },
    };
  }

  return {
    ok: true as const,
    payload: {
      ok: true,
      mode: "editor",
      matchedWork: result.tasks.map((task) => mapMobileWorkPost(task)),
      applications: result.applications.map((application) =>
        mapMobileApplication(application, result.tasks.find((task) => task.id === application.taskId)),
      ),
      invites: [],
      connections: [],
      totals: {
        availableWork: result.tasks.length,
        pendingApplications: result.applications.filter((item) => ["APPLIED", "SHORTLISTED"].includes(item.status)).length,
        activeConnections: result.applications.filter((item) => item.status === "ACCEPTED").length,
        invites: 0,
      },
    },
  };
}

export async function createMobileWorkPost(actor: Actor, input: JsonRecord) {
  const budgetAmount = amount(input.budgetMax) || amount(input.budgetMin);
  const result = await createMarketplaceTask(actor, {
    title: input.title,
    category: input.category,
    brief: input.description,
    budgetAmount,
    deadline: input.deadline,
    applicationDeadline: input.deadline,
    requiredSkills: list(input.skills ?? input.niche),
    productionTags: list(input.tags),
    referenceLinks: [...list(input.attachmentLinks), ...list(input.sampleLink)],
    sampleLink: input.sampleLink,
    projectScope: input.expectedOutput ?? input.workType,
    priority: input.workType === "URGENT" ? "URGENT" : "NORMAL",
    visibility: input.visibility === "AGENCY_TEAM" ? "AGENCY_TEAM" : input.visibility === "PRIVATE_INVITE" ? "INVITED_ONLY" : "PUBLIC",
  });
  if (!result.ok) return result;
  return { ok: true as const, workPost: mapMobileWorkPost(result.task) };
}

export async function applyToMobileWorkPost(actor: Actor, workPostId: string, input: JsonRecord) {
  const result = await createTaskApplication(actor, workPostId, {
    proposal: input.proposalMessage,
    quotedAmount: amount(input.expectedPayout),
    estimatedTurnaround: input.expectedDelivery ?? input.availability,
    portfolioReference: input.portfolioLinks ?? input.serviceId,
  });
  if (!result.ok) return result;
  return { ok: true as const, application: mapMobileApplication(result.application, result.task) };
}

export async function updateMobileWorkApplication(actor: Actor, applicationId: string, input: JsonRecord) {
  const status = String(input.status ?? "").toUpperCase();
  const action = status === "SHORTLISTED" ? "SHORTLIST" : status === "ACCEPTED" ? "ACCEPT" : status === "WITHDRAWN" ? "WITHDRAW" : "REJECT";
  const result = await updateTaskApplicationStatus(actor, applicationId, { action });
  if (!result.ok) return result;
  return { ok: true as const, application: mapMobileApplication(result.application) };
}

export async function inviteMobileEditor(actor: Actor, workPostId: string, input: JsonRecord) {
  const tenantId = actor.tenantId?.trim() ?? "";
  const editorId = String(input.editorId ?? "").trim();
  const result = await createTeamRequest(actor, tenantId, {
    freelancerId: editorId,
    roleType: "Project editor",
    message: String(input.message ?? "").trim() || `${actor.displayName} invited you to discuss project ${workPostId}.`,
    offeredTerms: `Project: ${workPostId}`,
  });
  if (!result.ok) return result;
  return {
    ok: true as const,
    invite: {
      inviteId: result.request.id,
      workPostId,
      agencyId: result.request.agencyUserId,
      agencyName: result.request.agencyName,
      editorId: result.request.freelancerId,
      editorName: result.request.freelancerName,
      message: result.request.message,
      status: "PENDING",
      createdAt: result.request.createdAt.toISOString(),
    },
  };
}

export async function respondToMobileWorkInvite(actor: Actor, inviteId: string, input: JsonRecord) {
  const status = String(input.status ?? "").toUpperCase();
  const result = await respondToTeamRequest(actor, inviteId, { action: status === "ACCEPTED" ? "ACCEPT" : "REJECT" });
  if (!result.ok) return result;
  return { ok: true as const, invite: { inviteId, status } };
}
