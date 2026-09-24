import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { AppRole, SessionUser } from "@/lib/auth/types";
import { assertPlanLimit, getEffectiveBillingPackageForUser } from "@/lib/billing/billing-access-service";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { prisma } from "@/lib/prisma";

type AuthorizedActor = Omit<SessionUser, "expiresAt" | "sessionId"> & Pick<SessionUser, "expiresAt" | "sessionId">;

function makeId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function sanitizeText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function parseDate(value: unknown, mode: "start" | "end" = "start") {
  const raw = sanitizeText(value);
  if (!raw) return null;
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dateOnlyMatch
    ? new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
        mode === "end" ? 23 : 0,
        mode === "end" ? 59 : 0,
        mode === "end" ? 59 : 0,
        mode === "end" ? 999 : 0,
      )
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parsePositiveAmount(value: unknown) {
  const amount = Math.round(Number(value ?? 0));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function canManageTenant(actor: AuthorizedActor, tenantId: string) {
  if (actor.role === "SUPER_ADMIN") return true;
  return (actor.role === "ADMIN" || actor.role === "MANAGER") && (Boolean(actor.tenantId) && (actor.tenantId === tenantId || actor.role === "ADMIN"));
}

function isFreelancer(role: AppRole) {
  return role === "FREELANCER" || role === "SUPER_ADMIN";
}

async function getAgencyWorkHubLimits(actor: AuthorizedActor, tenantId: string) {
  if (actor.role === "SUPER_ADMIN") {
    return null;
  }

  const [effectivePackage, activeTeamEditors, activeProjects] = await Promise.all([
    getEffectiveBillingPackageForUser(actor.userId),
    prisma.appTeamMembership.count({ where: { tenantId, status: "ACTIVE" } }),
    prisma.appMarketplaceTask.count({
      where: {
        tenantId,
        status: { in: ["PUBLISHED", "APPLICATIONS_OPEN", "ASSIGNED", "IN_PROGRESS"] },
      },
    }),
  ]);

    const pkg = effectivePackage?.package;
  const isPaid = Boolean(
    effectivePackage?.subscription?.status === "ACTIVE" &&
    pkg &&
    pkg.billingType !== "FREE" &&
    !pkg.isFree &&
    pkg.id !== "pkg-agency-freemium"
  );

  return {
    activeProjectLimit: isPaid ? (pkg?.activeProjectLimit ?? null) : 5,
    activeProjects,
    editorFreelancerLimit: isPaid ? (pkg?.editorFreelancerLimit ?? pkg?.teamMemberLimit ?? null) : 2,
    activeTeamEditors,
  };
}

async function expireStaleTasks(now = new Date()) {
  const expiryCutoff = new Date(now);
  expiryCutoff.setHours(0, 0, 0, 0);

  // 1. Close applications if applicationDeadline has arrived
  await prisma.appMarketplaceTask.updateMany({
    where: {
      status: { in: ["PUBLISHED", "APPLICATIONS_OPEN", "OPEN"] },
      applicationDeadline: { not: null, lt: expiryCutoff },
    },
    data: {
      status: "APPLICATIONS_CLOSED",
      updatedAt: now,
    },
  });

  // 2. Auto-disappear / expire work 24 hours after deadline or applicationDeadline hits
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await prisma.appMarketplaceTask.updateMany({
    where: {
      status: { notIn: ["DELETED", "EXPIRED", "COMPLETED", "ASSIGNED"] },
      OR: [
        { deadline: { not: null, lt: cutoff24h } },
        { applicationDeadline: { not: null, lt: cutoff24h } },
      ],
    },
    data: {
      status: "EXPIRED",
      updatedAt: now,
    },
  });
}

export async function listTasksForActor(actor: AuthorizedActor) {
  await expireStaleTasks();

  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (actor.role === "FREELANCER") {
    const activeMemberships = await prisma.appTeamMembership.findMany({
      where: { freelancerId: actor.userId, status: "ACTIVE" },
    });
    const restrictsExternalWork = activeMemberships.some((m) =>
      m.permissions.some((p) =>
        ["CANNOT_APPLY_EXTERNAL_WORK", "CANNOT_VIEW_OTHER_AGENCIES", "RESTRICT_EXTERNAL_WORK", "NO_EXTERNAL_AGENCIES"].includes(p.toUpperCase())
      )
    );
    const agencyTenantIds = activeMemberships.map((m) => m.tenantId);

    const tasks = await prisma.appMarketplaceTask.findMany({
      where: {
        status: { in: ["PUBLISHED", "APPLICATIONS_OPEN", "OPEN"] },
        AND: [
          { OR: [{ deadline: null }, { deadline: { gte: cutoff24h } }] },
          { OR: [{ applicationDeadline: null }, { applicationDeadline: { gte: cutoff24h } }] },
        ],
        ...(restrictsExternalWork ? { tenantId: { in: agencyTenantIds } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    const applications = await prisma.appTaskApplication.findMany({
      where: { freelancerId: actor.userId },
      orderBy: { createdAt: "desc" },
    });
    return { ok: true as const, tasks, applications };
  }

  if (actor.role === "SUPER_ADMIN") {
    const tasks = await prisma.appMarketplaceTask.findMany({
      where: { status: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
    });
    const applications = await prisma.appTaskApplication.findMany({ orderBy: { createdAt: "desc" } });
    return { ok: true as const, tasks, applications };
  }

  if (!actor.tenantId) {
    return { ok: false as const, status: 403, error: "Agency tenant is required." };
  }

  const tasks = await prisma.appMarketplaceTask.findMany({
    where: {
      status: { notIn: ["DELETED"] },
      OR: [
        { tenantId: actor.tenantId },
        { agencyUserId: actor.userId },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  const taskIds = tasks.map((t) => t.id);
  const applications = await prisma.appTaskApplication.findMany({
    where: {
      OR: [
        { tenantId: actor.tenantId },
        ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  return { ok: true as const, tasks, applications, limits: await getAgencyWorkHubLimits(actor, actor.tenantId) };
}

export async function createMarketplaceTask(
  actor: AuthorizedActor,
  input: {
    title?: unknown;
    category?: unknown;
    brief?: unknown;
    budgetAmount?: unknown;
    deadline?: unknown;
    requiredSkills?: unknown;
    referenceLinks?: unknown;
    visibility?: unknown;
    applicationDeadline?: unknown;
    priority?: unknown;
    productionTags?: unknown;
    sampleLink?: unknown;
    projectScope?: unknown;
  },
) {
  const tenantId = actor.tenantId?.trim() ?? "";
  if (!tenantId || !canManageTenant(actor, tenantId)) {
    return { ok: false as const, status: 403, error: "You do not have access to publish tasks for this agency." };
  }

  const title = sanitizeText(input.title);
  const category = sanitizeText(input.category, "Video Editing");
  const brief = sanitizeText(input.brief) || sanitizeText(input.projectScope) || `${title} video editing project.`;
  const budgetAmount = parsePositiveAmount(input.budgetAmount) || 1000;
  const visibility = sanitizeText(input.visibility, "PUBLIC").toUpperCase();
  const safeVisibility = visibility === "INVITED_ONLY" || visibility === "AGENCY_TEAM" ? visibility : "PUBLIC";
  const requiredSkills = normalizeList(input.requiredSkills);
  const sampleLink = sanitizeText(input.sampleLink);
  const referenceLinks = Array.from(new Set([...normalizeList(input.referenceLinks), ...(sampleLink ? [sampleLink] : [])]));
  const productionTags = normalizeList(input.productionTags);
  const projectScope = sanitizeText(input.projectScope) || "1 edited video + revisions";

  if (!title) {
    return { ok: false as const, status: 400, error: "Task title is required." };
  }

  if (actor.role !== "SUPER_ADMIN") {
    const activeProjectCount = await prisma.appMarketplaceTask.count({
      where: {
        tenantId,
        status: { in: ["PUBLISHED", "APPLICATIONS_OPEN", "ASSIGNED", "IN_PROGRESS"] },
      },
    });
    const limit = await assertPlanLimit({
      userId: actor.userId,
      limitKey: "activeProjectLimit",
      currentCount: activeProjectCount,
      label: "Active project",
    });
    if (!limit.ok) {
      return { ok: false as const, status: 402, error: limit.error };
    }
  }

  const deadline = parseDate(input.deadline, "end");
  const applicationDeadline = parseDate(input.applicationDeadline, "end");
  const task = await prisma.appMarketplaceTask.create({
    data: {
      id: makeId("task"),
      tenantId,
      agencyUserId: actor.userId,
      agencyName: actor.displayName || "Agency workspace",
      title,
      category,
      brief,
      budgetAmount,
      deadline,
      requiredSkills,
      referenceLinks,
      visibility: safeVisibility,
      applicationDeadline,
      status: "APPLICATIONS_OPEN",
      metadata: {
        createdByRole: actor.role,
        productionTags,
        projectScope,
        sampleLink,
        priority: sanitizeText(input.priority, "NORMAL").toUpperCase() || "NORMAL",
      } satisfies Prisma.InputJsonObject,
    },
  });

  return { ok: true as const, task };
}

export async function createTaskApplication(
  actor: AuthorizedActor,
  taskId: string,
  input: {
    proposal?: unknown;
    quotedAmount?: unknown;
    estimatedTurnaround?: unknown;
    portfolioReference?: unknown;
  },
) {
  if (!isFreelancer(actor.role)) {
    return { ok: false as const, status: 403, error: "Only freelancers can apply for marketplace tasks." };
  }

  const task = await prisma.appMarketplaceTask.findUnique({ where: { id: taskId.trim() } });
  if (!task) {
    return { ok: false as const, status: 404, error: "Task was not found." };
  }

  if (!["PUBLISHED", "APPLICATIONS_OPEN", "OPEN"].includes(task.status)) {
    return { ok: false as const, status: 409, error: "Applications are closed for this task." };
  }

  const activeMemberships = await prisma.appTeamMembership.findMany({
    where: { freelancerId: actor.userId, status: "ACTIVE" },
  });
  const restrictsExternalWork = activeMemberships.some((m) =>
    m.permissions.some((p) =>
      ["CANNOT_APPLY_EXTERNAL_WORK", "CANNOT_VIEW_OTHER_AGENCIES", "RESTRICT_EXTERNAL_WORK", "NO_EXTERNAL_AGENCIES"].includes(p.toUpperCase())
    )
  );
  if (restrictsExternalWork) {
    const allowedTenantIds = new Set(activeMemberships.map((m) => m.tenantId));
    if (!allowedTenantIds.has(task.tenantId)) {
      return { ok: false as const, status: 403, error: "Your agency membership does not permit applying to external agency tasks." };
    }
  }

  const proposal = sanitizeText(input.proposal);
  const quotedAmount = parsePositiveAmount(input.quotedAmount) ?? task.budgetAmount ?? 500;
  const estimatedTurnaround = sanitizeText(input.estimatedTurnaround, "2-3 Days");
  const portfolioReference = sanitizeText(input.portfolioReference);
  if (!proposal) {
    return { ok: false as const, status: 400, error: "Proposal message is required." };
  }

  const application = await prisma.appTaskApplication.upsert({
    where: {
      taskId_freelancerId: {
        taskId: task.id,
        freelancerId: actor.userId,
      },
    },
    create: {
      id: makeId("application"),
      taskId: task.id,
      tenantId: task.tenantId,
      freelancerId: actor.userId,
      freelancerName: actor.displayName,
      proposal,
      quotedAmount,
      estimatedTurnaround,
      portfolioReference,
      status: "APPLIED",
      metadata: {
        source: "marketplace_task",
      } satisfies Prisma.InputJsonObject,
    },
    update: {
      proposal,
      quotedAmount,
      estimatedTurnaround,
      portfolioReference,
      status: "APPLIED",
    },
  });

  await createAppNotification({
    userId: task.agencyUserId,
    tenantId: task.tenantId,
    type: "task_application_received",
    title: "New freelancer application",
    message: `${actor.displayName} applied to ${task.title}.`,
    entityType: "task_application",
    entityId: application.id,
  });

  return { ok: true as const, task, application };
}

export async function listTaskApplications(actor: AuthorizedActor, taskId: string) {
  const task = await prisma.appMarketplaceTask.findUnique({ where: { id: taskId.trim() } });
  if (!task) return { ok: false as const, status: 404, error: "Task was not found." };
  if (!canManageTenant(actor, task.tenantId)) {
    return { ok: false as const, status: 403, error: "You do not have access to this task." };
  }

  const applications = await prisma.appTaskApplication.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: "desc" },
  });
  return { ok: true as const, task, applications };
}

export async function updateTaskApplicationStatus(
  actor: AuthorizedActor,
  applicationId: string,
  input: {
    action?: unknown;
    note?: unknown;
  },
) {
  const application = await prisma.appTaskApplication.findUnique({ where: { id: applicationId.trim() } });
  if (!application) return { ok: false as const, status: 404, error: "Application was not found." };

  const task = await prisma.appMarketplaceTask.findUnique({ where: { id: application.taskId } });
  if (!task) return { ok: false as const, status: 404, error: "Task was not found." };

  const action = sanitizeText(input.action).toUpperCase();
  if (!["SHORTLIST", "REJECT", "ACCEPT", "WITHDRAW"].includes(action)) {
    return { ok: false as const, status: 400, error: "Choose shortlist, reject, accept, or withdraw." };
  }
  const canWithdrawOwnApplication = action === "WITHDRAW" && actor.role === "FREELANCER" && application.freelancerId === actor.userId;
  if (!canWithdrawOwnApplication && !canManageTenant(actor, task.tenantId)) {
    return { ok: false as const, status: 403, error: "You do not have access to this application." };
  }

  if (action === "ACCEPT") {
    const assignmentId = makeId("assignment");
    const now = new Date();
    const [updatedApplication, assignment] = await prisma.$transaction([
      prisma.appTaskApplication.update({
        where: { id: application.id },
        data: {
          status: "ACCEPTED",
          metadata: {
            ...((application.metadata as Prisma.JsonObject) ?? {}),
            reviewNote: sanitizeText(input.note),
            reviewedByUserId: actor.userId,
          },
        },
      }),
      prisma.appAssignmentRecord.create({
        data: {
          id: assignmentId,
          tenantId: task.tenantId,
          agencyUserId: task.agencyUserId,
          agencyName: task.agencyName,
          freelancerId: application.freelancerId,
          freelancerName: application.freelancerName,
          taskId: task.id,
          applicationId: application.id,
          title: task.title,
          brief: task.brief,
          category: task.category,
          deadline: task.deadline,
          budgetAmount: application.quotedAmount || task.budgetAmount,
          priority: sanitizeText((task.metadata as Prisma.JsonObject)?.priority, "NORMAL"),
          status: "ASSIGNED",
          notes: sanitizeText(input.note),
          acceptedAt: now,
          metadata: {
            createdFrom: "task_application",
            acceptedByUserId: actor.userId,
          } satisfies Prisma.InputJsonObject,
        },
      }),
      prisma.appMarketplaceTask.update({
        where: { id: task.id },
        data: {
          status: "ASSIGNED",
          assignedFreelancerId: application.freelancerId,
          acceptedApplicationId: application.id,
        },
      }),
      prisma.appTaskApplication.updateMany({
        where: {
          taskId: task.id,
          id: { not: application.id },
          status: { in: ["APPLIED", "SHORTLISTED"] },
        },
        data: { status: "REJECTED" },
      }),
    ]);

    await createAppNotification({
      userId: application.freelancerId,
      tenantId: task.tenantId,
      type: "task_application_accepted",
      title: "Application accepted",
      message: `${task.agencyName} accepted your application for ${task.title}.`,
      entityType: "assignment",
      entityId: assignment.id,
    });

    return { ok: true as const, application: updatedApplication, assignment };
  }

  const nextStatus = action === "SHORTLIST" ? "SHORTLISTED" : action === "WITHDRAW" ? "WITHDRAWN" : "REJECTED";
  const updatedApplication = await prisma.appTaskApplication.update({
    where: { id: application.id },
    data: {
      status: nextStatus,
      metadata: {
        ...((application.metadata as Prisma.JsonObject) ?? {}),
        reviewNote: sanitizeText(input.note),
        reviewedByUserId: actor.userId,
      },
    },
  });
  await createAppNotification({
    userId: application.freelancerId,
    tenantId: task.tenantId,
    type: `task_application_${nextStatus.toLowerCase()}`,
    title: `Application ${nextStatus.toLowerCase()}`,
    message: `${task.agencyName} marked your application for ${task.title} as ${nextStatus.toLowerCase()}.`,
    entityType: "task_application",
    entityId: updatedApplication.id,
  });
  return { ok: true as const, application: updatedApplication, assignment: null };
}

export async function deleteMarketplaceTask(actor: AuthorizedActor, taskId: string) {
  const tenantId = actor.tenantId?.trim() ?? "";
  if (!tenantId && actor.role !== "SUPER_ADMIN") {
    return { ok: false as const, status: 403, error: "Agency tenant is required to delete work." };
  }

  const existing = await prisma.appMarketplaceTask.findUnique({
    where: { id: taskId },
  });

  if (!existing || (existing.tenantId !== tenantId && actor.role !== "SUPER_ADMIN")) {
    return { ok: false as const, status: 404, error: "Work post not found." };
  }

  try {
    await prisma.$transaction([
      prisma.appTaskApplication.deleteMany({
        where: { taskId },
      }),
      prisma.appMarketplaceTask.delete({
        where: { id: taskId },
      }),
    ]);
  } catch {
    // If foreign key constraints or active assignments prevent hard delete, mark as DELETED
    await prisma.appMarketplaceTask.update({
      where: { id: taskId },
      data: {
        status: "DELETED",
        updatedAt: new Date(),
      },
    });
  }

  return { ok: true as const, taskId };
}

export async function updateMarketplaceTask(
  actor: AuthorizedActor,
  taskId: string,
  input: {
    title?: unknown;
    category?: unknown;
    brief?: unknown;
    budgetAmount?: unknown;
    deadline?: unknown;
    requiredSkills?: unknown;
    referenceLinks?: unknown;
    visibility?: unknown;
    status?: unknown;
    priority?: unknown;
    productionTags?: unknown;
    sampleLink?: unknown;
    projectScope?: unknown;
  },
) {
  const tenantId = actor.tenantId?.trim() ?? "";
  if (!tenantId && actor.role !== "SUPER_ADMIN") {
    return { ok: false as const, status: 403, error: "Agency tenant is required to update work." };
  }

  const existing = await prisma.appMarketplaceTask.findUnique({
    where: { id: taskId },
  });

  if (!existing || (existing.tenantId !== tenantId && actor.role !== "SUPER_ADMIN")) {
    return { ok: false as const, status: 404, error: "Work post not found." };
  }

  const title = input.title !== undefined ? sanitizeText(input.title) : existing.title;
  const category = input.category !== undefined ? sanitizeText(input.category, "Video Editing") : existing.category;
  const brief = input.brief !== undefined ? sanitizeText(input.brief) : existing.brief;
  const budgetAmount = input.budgetAmount !== undefined ? parsePositiveAmount(input.budgetAmount) || existing.budgetAmount : existing.budgetAmount;
  const requiredSkills = input.requiredSkills !== undefined ? normalizeList(input.requiredSkills) : existing.requiredSkills;
  const referenceLinks = input.referenceLinks !== undefined ? normalizeList(input.referenceLinks) : existing.referenceLinks;
  const deadline = input.deadline !== undefined ? parseDate(input.deadline, "end") : existing.deadline;
  const status = input.status !== undefined ? sanitizeText(input.status).toUpperCase() : existing.status;

  const existingMeta = (existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}) as Record<string, unknown>;
  const updatedMeta: Prisma.InputJsonObject = {
    ...existingMeta,
    ...(input.priority !== undefined ? { priority: sanitizeText(input.priority, "NORMAL").toUpperCase() } : {}),
    ...(input.projectScope !== undefined ? { projectScope: sanitizeText(input.projectScope) } : {}),
    ...(input.sampleLink !== undefined ? { sampleLink: sanitizeText(input.sampleLink) } : {}),
    ...(input.productionTags !== undefined ? { productionTags: normalizeList(input.productionTags) } : {}),
  };

  const updatedTask = await prisma.appMarketplaceTask.update({
    where: { id: taskId },
    data: {
      title,
      category,
      brief,
      budgetAmount,
      requiredSkills,
      referenceLinks,
      deadline,
      status,
      metadata: updatedMeta,
      updatedAt: new Date(),
    },
  });

  return { ok: true as const, task: updatedTask };
}
