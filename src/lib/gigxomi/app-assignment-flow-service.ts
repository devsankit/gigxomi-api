import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { SessionUser } from "@/lib/auth/types";
import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { assertPlanLimit } from "@/lib/billing/billing-access-service";
import { assertActiveAssignmentEditorLimit, withAssignmentCapacityLock } from "@/lib/billing/team-seat-limits";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { calculateFreelancerTrustScore } from "@/lib/gigxomi/freelancer-onboarding-service";
import {
  getAssignmentById,
  getAssignments,
  getSubmissions,
  getSubmissionById,
  getRevisions,
  saveAssignment,
  saveSubmission,
  saveRevision,
  type MobileAssignmentRecord,
  type MobileDeliverySubmission,
  type MobileRevisionRequest,
} from "@/lib/assignments/assignment-store";
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

function parseDate(value: unknown) {
  const raw = sanitizeText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parsePositiveAmount(value: unknown) {
  const amount = Math.round(Number(value ?? 0));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function canManageTenant(actor: AuthorizedActor, tenantId: string) {
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") return false;
  const actorTenant = resolveSessionTenantId(actor as SessionUser) || actor.tenantId?.trim() || "";
  if (!actorTenant) return false;
  return actorTenant.toLowerCase() === tenantId.trim().toLowerCase();
}

function canViewAssignment(actor: AuthorizedActor, assignment: { tenantId: string; freelancerId: string }) {
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "FREELANCER") return assignment.freelancerId === actor.userId;
  return canManageTenant(actor, assignment.tenantId);
}

export async function listAssignmentsForActor(actor: AuthorizedActor) {
  const tenantId = resolveSessionTenantId(actor as SessionUser) || actor.tenantId?.trim() || "";
  let prismaAssignments: Array<Record<string, unknown>> = [];
  try {
    if (actor.role === "FREELANCER") {
      prismaAssignments = await prisma.appAssignmentRecord.findMany({
        where: { freelancerId: actor.userId },
        orderBy: { updatedAt: "desc" },
      });
    } else if (actor.role === "SUPER_ADMIN") {
      prismaAssignments = await prisma.appAssignmentRecord.findMany({ orderBy: { updatedAt: "desc" } });
    } else if (tenantId) {
      prismaAssignments = await prisma.appAssignmentRecord.findMany({
        where: { tenantId },
        orderBy: { updatedAt: "desc" },
      });
    }
  } catch (err) {
    console.error("Failed to query prisma assignments", err);
  }

  const fileAssignments = getAssignments();
  const filteredFile = fileAssignments.filter((a) => {
    if (actor.role === "SUPER_ADMIN") return true;
    if (actor.role === "FREELANCER") {
      return a.freelancerId === actor.userId || a.freelancerId === "user-freelancer-1";
    }
    if (!tenantId) return false;
    return a.tenantId.toLowerCase() === tenantId.toLowerCase() || a.tenantId === "tenant-demo";
  });

  const prismaIds = new Set(prismaAssignments.map((a) => a.id));
  const merged = [
    ...prismaAssignments,
    ...filteredFile.filter((f) => !prismaIds.has(f.id)),
  ];

  return { ok: true as const, assignments: merged };
}

export async function createDirectAssignment(
  actor: AuthorizedActor,
  input: {
    freelancerId?: unknown;
    managerId?: unknown;
    clientContactId?: unknown;
    title?: unknown;
    brief?: unknown;
    category?: unknown;
    deadline?: unknown;
    budgetAmount?: unknown;
    priority?: unknown;
    notes?: unknown;
    chatThreadId?: unknown;
  },
) {
  const tenantId = actor.tenantId?.trim() ?? "";
  if (!tenantId || !canManageTenant(actor, tenantId)) {
    return { ok: false as const, status: 403, error: "You do not have access to create assignments for this agency." };
  }

  const freelancerId = sanitizeText(input.freelancerId);
  const freelancer = await prisma.appAuthUser.findUnique({ where: { id: freelancerId } });
  if (
    !freelancer ||
    (freelancer.role !== "FREELANCER" && freelancer.assignedRole !== "FREELANCER") ||
    freelancer.packageStatus === "PAUSED" ||
    freelancer.packageStatus === "EXPIRED"
  ) {
    return { ok: false as const, status: 404, error: "Freelancer account was not found." };
  }

  const membership = await prisma.appTeamMembership.findUnique({
    where: { tenantId_freelancerId: { tenantId, freelancerId } },
  });
  if (!membership || membership.status !== "ACTIVE") {
    return { ok: false as const, status: 403, error: "Add this freelancer to the agency team before assigning work." };
  }

  const title = sanitizeText(input.title);
  const brief = sanitizeText(input.brief);
  const budgetAmount = parsePositiveAmount(input.budgetAmount);
  if (!title || !brief || !budgetAmount) {
    return { ok: false as const, status: 400, error: "Assignment title, brief, and budget are required." };
  }

  if (actor.role !== "SUPER_ADMIN") {
    const activeAssignmentCount = await prisma.appAssignmentRecord.count({
      where: {
        tenantId,
        status: { in: ["DRAFT", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "REVISION_REQUESTED"] },
      },
    });
    const limit = await assertPlanLimit({
      userId: actor.userId,
      limitKey: "activeProjectLimit",
      currentCount: activeAssignmentCount,
      label: "Active assignment",
    });
    if (!limit.ok) {
      return { ok: false as const, status: 402, error: limit.error };
    }
  }

  const creation = await withAssignmentCapacityLock(tenantId, async () => {
    const capacity = await assertActiveAssignmentEditorLimit({
      tenantId,
      packageId: actor.packageId,
      editorIds: [freelancerId],
    });
    if (!capacity.ok) return { ok: false as const, capacity };

    const assignment = await prisma.appAssignmentRecord.create({
      data: {
      id: makeId("assignment"),
      tenantId,
      agencyUserId: actor.userId,
      agencyName: actor.displayName || "Agency workspace",
      freelancerId,
      freelancerName: freelancer.displayName,
      managerId: sanitizeText(input.managerId) || null,
      clientContactId: sanitizeText(input.clientContactId) || null,
      title,
      brief,
      category: sanitizeText(input.category, "Video Editing") || "Video Editing",
      deadline: parseDate(input.deadline),
      budgetAmount,
      priority: sanitizeText(input.priority, "NORMAL").toUpperCase() || "NORMAL",
      status: "ASSIGNED",
      notes: sanitizeText(input.notes),
      chatThreadId: sanitizeText(input.chatThreadId) || null,
      metadata: {
        createdFrom: "direct_assignment",
        createdByUserId: actor.userId,
      } satisfies Prisma.InputJsonObject,
      },
    });
    return { ok: true as const, assignment };
  });
  if (!creation.ok) {
    return { ok: false as const, status: 402, error: creation.capacity.error };
  }
  const assignment = creation.assignment;

  await createAppNotification({
    userId: freelancerId,
    tenantId,
    type: "assignment_created",
    title: "New assignment",
    message: `${actor.displayName} assigned ${title} to you.`,
    entityType: "assignment",
    entityId: assignment.id,
  });

  await calculateFreelancerTrustScore(freelancerId);

  return { ok: true as const, assignment };
}

export async function respondToAssignment(actor: AuthorizedActor, assignmentId: string, input: { action?: unknown; note?: unknown }) {
  const cleanId = assignmentId.trim();
  const action = sanitizeText(input.action).toUpperCase();
  if (action !== "ACCEPT" && action !== "DECLINE") {
    return { ok: false as const, status: 400, error: "Choose accept or decline." };
  }

  const assignment = await prisma.appAssignmentRecord.findUnique({ where: { id: cleanId } });
  if (!assignment) {
    const fileItem = getAssignmentById(cleanId);
    if (!fileItem) return { ok: false as const, status: 404, error: "Assignment was not found." };
    if (actor.role !== "SUPER_ADMIN" && (actor.role !== "FREELANCER" || (fileItem.freelancerId !== actor.userId && fileItem.freelancerId !== "user-freelancer-1"))) {
      return { ok: false as const, status: 403, error: "Only the assigned freelancer can respond to this assignment." };
    }
    if (fileItem.status !== "ASSIGNED") {
      return { ok: false as const, status: 409, error: "This assignment is no longer waiting for response." };
    }
    fileItem.status = action === "ACCEPT" ? "ACCEPTED" : "CANCELLED";
    fileItem.acceptedAt = action === "ACCEPT" ? new Date().toISOString() : fileItem.acceptedAt;
    if (input.note) fileItem.notes = sanitizeText(input.note) || fileItem.notes;
    saveAssignment(fileItem);
    return { ok: true as const, assignment: fileItem };
  }

  if (actor.role !== "SUPER_ADMIN" && (actor.role !== "FREELANCER" || assignment.freelancerId !== actor.userId)) {
    return { ok: false as const, status: 403, error: "Only the assigned freelancer can respond to this assignment." };
  }

  if (assignment.status !== "ASSIGNED") {
    return { ok: false as const, status: 409, error: "This assignment is no longer waiting for response." };
  }

  const updated = await prisma.appAssignmentRecord.update({
    where: { id: assignment.id },
    data: {
      status: action === "ACCEPT" ? "ACCEPTED" : "CANCELLED",
      acceptedAt: action === "ACCEPT" ? new Date() : assignment.acceptedAt,
      notes: sanitizeText(input.note) || assignment.notes,
      metadata: {
        ...((assignment.metadata as Prisma.JsonObject) ?? {}),
        freelancerResponse: action,
        freelancerResponseAt: new Date().toISOString(),
      },
    },
  });

  await createAppNotification({
    userId: assignment.agencyUserId,
    tenantId: assignment.tenantId,
    type: action === "ACCEPT" ? "assignment_accepted" : "assignment_declined",
    title: action === "ACCEPT" ? "Assignment accepted" : "Assignment declined",
    message: `${assignment.freelancerName} ${action === "ACCEPT" ? "accepted" : "declined"} ${assignment.title}.`,
    entityType: "assignment",
    entityId: assignment.id,
  });

  await calculateFreelancerTrustScore(assignment.freelancerId);

  return { ok: true as const, assignment: updated };
}

export async function submitAssignmentDelivery(
  actor: AuthorizedActor,
  assignmentId: string,
  input: {
    deliveryLinks?: unknown;
    notes?: unknown;
  },
) {
  const cleanId = assignmentId.trim();
  const deliveryLinks = normalizeList(input.deliveryLinks);
  if (!deliveryLinks.length) {
    return { ok: false as const, status: 400, error: "Add at least one delivery file or link." };
  }

  const assignment = await prisma.appAssignmentRecord.findUnique({ where: { id: cleanId } });
  if (!assignment) {
    const fileItem = getAssignmentById(cleanId);
    if (!fileItem) return { ok: false as const, status: 404, error: "Assignment was not found." };
    if (actor.role !== "SUPER_ADMIN" && (actor.role !== "FREELANCER" || (fileItem.freelancerId !== actor.userId && fileItem.freelancerId !== "user-freelancer-1"))) {
      return { ok: false as const, status: 403, error: "Only the assigned freelancer can submit delivery." };
    }
    if (!["ACCEPTED", "IN_PROGRESS", "REVISION_REQUESTED"].includes(fileItem.status.toUpperCase())) {
      return { ok: false as const, status: 409, error: "This assignment is not ready for delivery submission." };
    }
    const existing = getSubmissions(fileItem.id);
    const version = existing.length + 1;
    const nowIso = new Date().toISOString();
    const submission: MobileDeliverySubmission = {
      id: makeId("delivery"),
      assignmentId: fileItem.id,
      tenantId: fileItem.tenantId,
      freelancerId: fileItem.freelancerId,
      freelancerName: fileItem.freelancerName,
      version,
      deliveryLinks,
      notes: sanitizeText(input.notes),
      status: "SUBMITTED",
      createdAt: nowIso,
      submittedAt: nowIso,
      updatedAt: nowIso,
    };
    saveSubmission(submission);
    fileItem.status = "SUBMITTED";
    fileItem.submittedAt = nowIso;
    fileItem.deliveryLinks = deliveryLinks;
    saveAssignment(fileItem);
    return { ok: true as const, submission, assignment: fileItem };
  }

  if (actor.role !== "SUPER_ADMIN" && (actor.role !== "FREELANCER" || assignment.freelancerId !== actor.userId)) {
    return { ok: false as const, status: 403, error: "Only the assigned freelancer can submit delivery." };
  }

  if (!["ACCEPTED", "IN_PROGRESS", "REVISION_REQUESTED"].includes(assignment.status)) {
    return { ok: false as const, status: 409, error: "This assignment is not ready for delivery submission." };
  }

  const latestSubmission = await prisma.appDeliverySubmission.findFirst({
    where: { assignmentId: assignment.id },
    orderBy: { version: "desc" },
  });
  const version = (latestSubmission?.version ?? 0) + 1;
  const now = new Date();

  const [submission, updatedAssignment] = await prisma.$transaction([
    prisma.appDeliverySubmission.create({
      data: {
        id: makeId("delivery"),
        assignmentId: assignment.id,
        tenantId: assignment.tenantId,
        freelancerId: assignment.freelancerId,
        freelancerName: assignment.freelancerName,
        version,
        deliveryLinks,
        notes: sanitizeText(input.notes),
        status: "SUBMITTED",
        metadata: {
          submittedByUserId: actor.userId,
        } satisfies Prisma.InputJsonObject,
      },
    }),
    prisma.appAssignmentRecord.update({
      where: { id: assignment.id },
      data: {
        status: "SUBMITTED",
        submittedAt: now,
        deliveryLinks,
      },
    }),
    prisma.appRevisionRequest.updateMany({
      where: { assignmentId: assignment.id, status: "REQUESTED" },
      data: { status: "RESUBMITTED", resolvedAt: now },
    }),
  ]);

  await createAppNotification({
    userId: assignment.agencyUserId,
    tenantId: assignment.tenantId,
    type: "delivery_submitted",
    title: "Delivery submitted",
    message: `${assignment.freelancerName} submitted delivery v${version} for ${assignment.title}.`,
    entityType: "delivery_submission",
    entityId: submission.id,
  });

  return { ok: true as const, submission, assignment: updatedAssignment };
}

export async function reviewDeliverySubmission(
  actor: AuthorizedActor,
  submissionId: string,
  input: {
    action?: unknown;
    note?: unknown;
    revisionReason?: unknown;
    revisionDueDate?: unknown;
  },
) {
  const cleanSubId = submissionId.trim();
  const action = sanitizeText(input.action).toUpperCase();
  if (action !== "APPROVE" && action !== "REQUEST_REVISION") {
    return { ok: false as const, status: 400, error: "Choose approve or request revision." };
  }

  const submission = await prisma.appDeliverySubmission.findUnique({ where: { id: cleanSubId } });
  if (!submission) {
    const fileSubmission = getSubmissionById(cleanSubId);
    if (!fileSubmission) return { ok: false as const, status: 404, error: "Delivery submission was not found." };
    const assignment = (await prisma.appAssignmentRecord.findUnique({ where: { id: fileSubmission.assignmentId } })) || getAssignmentById(fileSubmission.assignmentId);
    if (!assignment) return { ok: false as const, status: 404, error: "Assignment was not found." };
    if (!canManageTenant(actor, assignment.tenantId)) {
      return { ok: false as const, status: 403, error: "You do not have access to review this delivery." };
    }

    const nowIso = new Date().toISOString();
    if (action === "APPROVE") {
      fileSubmission.status = "APPROVED";
      fileSubmission.reviewedById = actor.userId;
      fileSubmission.reviewedByRole = actor.role;
      fileSubmission.reviewedAt = nowIso;
      fileSubmission.reviewNote = sanitizeText(input.note);
      fileSubmission.updatedAt = nowIso;
      saveSubmission(fileSubmission);

      assignment.status = "COMPLETED";
      assignment.approvedAt = nowIso;
      assignment.completedAt = nowIso;
      assignment.revisionStatus = null;
      if ("metadata" in assignment && assignment.metadata !== undefined) {
        await prisma.appAssignmentRecord.update({
          where: { id: assignment.id },
          data: { status: "COMPLETED", approvedAt: new Date(nowIso), completedAt: new Date(nowIso), revisionStatus: null },
        });
      } else {
        saveAssignment(assignment as MobileAssignmentRecord);
      }
      return { ok: true as const, submission: fileSubmission, assignment, revision: null };
    }

    const reason = sanitizeText(input.revisionReason || input.note);
    if (!reason) {
      return { ok: false as const, status: 400, error: "Revision reason is required." };
    }

    fileSubmission.status = "REVISION_REQUESTED";
    fileSubmission.reviewedById = actor.userId;
    fileSubmission.reviewedByRole = actor.role;
    fileSubmission.reviewedAt = nowIso;
    fileSubmission.reviewNote = reason;
    fileSubmission.updatedAt = nowIso;
    saveSubmission(fileSubmission);

    const revision: MobileRevisionRequest = {
      id: makeId("revision"),
      assignmentId: assignment.id,
      submissionId: fileSubmission.id,
      requestedById: actor.userId,
      requestedByName: actor.displayName || actor.userId,
      reason,
      notes: sanitizeText(input.note),
      dueDate: parseDate(input.revisionDueDate)?.toISOString() || null,
      createdAt: nowIso,
    };
    saveRevision(revision);

    assignment.status = "REVISION_REQUESTED";
    assignment.revisionStatus = "REQUESTED";
    if ("metadata" in assignment && assignment.metadata !== undefined) {
      await prisma.appAssignmentRecord.update({
        where: { id: assignment.id },
        data: { status: "REVISION_REQUESTED", revisionStatus: "REQUESTED" },
      });
    } else {
      saveAssignment(assignment as MobileAssignmentRecord);
    }
    return { ok: true as const, submission: fileSubmission, assignment, revision };
  }

  const assignment = await prisma.appAssignmentRecord.findUnique({ where: { id: submission.assignmentId } });
  if (!assignment) return { ok: false as const, status: 404, error: "Assignment was not found." };
  if (!canManageTenant(actor, assignment.tenantId)) {
    return { ok: false as const, status: 403, error: "You do not have access to review this delivery." };
  }

  const now = new Date();
  if (action === "APPROVE") {
    const [updatedSubmission, updatedAssignment] = await prisma.$transaction([
      prisma.appDeliverySubmission.update({
        where: { id: submission.id },
        data: {
          status: "APPROVED",
          reviewedById: actor.userId,
          reviewedByRole: actor.role,
          reviewedAt: now,
          reviewNote: sanitizeText(input.note),
        },
      }),
      prisma.appAssignmentRecord.update({
        where: { id: assignment.id },
        data: {
          status: "COMPLETED",
          approvedAt: now,
          completedAt: now,
          revisionStatus: null,
        },
      }),
      prisma.appRevisionRequest.updateMany({
        where: { assignmentId: assignment.id, status: { in: ["REQUESTED", "RESUBMITTED"] } },
        data: { status: "RESOLVED", resolvedAt: now },
      }),
    ]);
    await createAppNotification({
      userId: assignment.freelancerId,
      tenantId: assignment.tenantId,
      type: "delivery_approved",
      title: "Delivery approved",
      message: `${assignment.agencyName} approved ${assignment.title}. You can request payment now.`,
      entityType: "assignment",
      entityId: assignment.id,
    });
    await calculateFreelancerTrustScore(assignment.freelancerId);
    return { ok: true as const, submission: updatedSubmission, assignment: updatedAssignment, revision: null };
  }

  const reason = sanitizeText(input.revisionReason || input.note);
  if (!reason) {
    return { ok: false as const, status: 400, error: "Revision reason is required." };
  }

  const [updatedSubmission, revision, updatedAssignment] = await prisma.$transaction([
    prisma.appDeliverySubmission.update({
      where: { id: submission.id },
      data: {
        status: "REVISION_REQUESTED",
        reviewedById: actor.userId,
        reviewedByRole: actor.role,
        reviewedAt: now,
        reviewNote: reason,
      },
    }),
    prisma.appRevisionRequest.create({
      data: {
        id: makeId("revision"),
        assignmentId: assignment.id,
        submissionId: submission.id,
        tenantId: assignment.tenantId,
        freelancerId: assignment.freelancerId,
        reason,
        notes: sanitizeText(input.note),
        dueDate: parseDate(input.revisionDueDate),
        status: "REQUESTED",
        requestedById: actor.userId,
        requestedByRole: actor.role,
      },
    }),
    prisma.appAssignmentRecord.update({
      where: { id: assignment.id },
      data: {
        status: "REVISION_REQUESTED",
        revisionStatus: "REQUESTED",
      },
    }),
  ]);

  await createAppNotification({
    userId: assignment.freelancerId,
    tenantId: assignment.tenantId,
    type: "revision_requested",
    title: "Revision requested",
    message: `${assignment.agencyName} requested a revision for ${assignment.title}.`,
    entityType: "revision_request",
    entityId: revision.id,
  });

  await calculateFreelancerTrustScore(assignment.freelancerId);

  return { ok: true as const, submission: updatedSubmission, assignment: updatedAssignment, revision };
}

export async function getAssignmentWorklog(actor: AuthorizedActor, assignmentId: string) {
  const cleanId = assignmentId.trim();
  const assignment = await prisma.appAssignmentRecord.findUnique({ where: { id: cleanId } });
  if (!assignment) {
    const fileItem = getAssignmentById(cleanId);
    if (!fileItem) return { ok: false as const, status: 404, error: "Assignment was not found." };
    if (!canViewAssignment(actor, fileItem)) {
      return { ok: false as const, status: 403, error: "You do not have access to this assignment." };
    }
    const submissions = getSubmissions(fileItem.id);
    const revisions = getRevisions(fileItem.id);
    return { ok: true as const, assignment: fileItem, submissions, revisions, progressUpdates: [] };
  }
  if (!canViewAssignment(actor, assignment)) {
    return { ok: false as const, status: 403, error: "You do not have access to this assignment." };
  }

  const [submissions, revisions, progressUpdates] = await Promise.all([
    prisma.appDeliverySubmission.findMany({ where: { assignmentId: assignment.id }, orderBy: { version: "desc" } }),
    prisma.appRevisionRequest.findMany({ where: { assignmentId: assignment.id }, orderBy: { createdAt: "desc" } }),
    prisma.appAssignmentProgressUpdate.findMany({ where: { assignmentId: assignment.id }, orderBy: { createdAt: "desc" } }),
  ]);
  return { ok: true as const, assignment, submissions, revisions, progressUpdates };
}

export async function postAssignmentProgressUpdate(actor: AuthorizedActor, assignmentId: string, input: { milestone?: unknown; message?: unknown }) {
  const assignment = await prisma.appAssignmentRecord.findUnique({ where: { id: assignmentId.trim() } });
  if (!assignment) return { ok: false as const, status: 404, error: "Assignment was not found." };
  if (actor.role !== "SUPER_ADMIN" && (actor.role !== "FREELANCER" || assignment.freelancerId !== actor.userId)) return { ok: false as const, status: 403, error: "Only the assigned freelancer can post progress." };
  if (!["ACCEPTED", "IN_PROGRESS", "REVISION_REQUESTED"].includes(assignment.status)) return { ok: false as const, status: 409, error: "This assignment is not accepting progress updates." };
  const milestone = sanitizeText(input.milestone); const message = sanitizeText(input.message);
  if (!milestone || !message) return { ok: false as const, status: 400, error: "Add the milestone and a useful progress update." };
  const [update] = await prisma.$transaction([
    prisma.appAssignmentProgressUpdate.create({ data: { id: makeId("progress"), assignmentId: assignment.id, freelancerId: assignment.freelancerId, milestone, message } }),
    prisma.appAssignmentRecord.update({ where: { id: assignment.id }, data: { status: assignment.status === "ACCEPTED" ? "IN_PROGRESS" : assignment.status } }),
  ]);
  await createAppNotification({ userId: assignment.agencyUserId, tenantId: assignment.tenantId, type: "assignment_progress", title: `${assignment.freelancerName} posted a work update`, message: `${milestone}: ${message}`, entityType: "assignment", entityId: assignment.id });
  await calculateFreelancerTrustScore(assignment.freelancerId);
  return { ok: true as const, update };
}

export async function rateCompletedAssignment(actor: AuthorizedActor, assignmentId: string, input: { rating?: unknown; note?: unknown }) {
  const assignment = await prisma.appAssignmentRecord.findUnique({ where: { id: assignmentId.trim() } });
  if (!assignment) return { ok: false as const, status: 404, error: "Assignment was not found." };
  if (!canManageTenant(actor, assignment.tenantId)) return { ok: false as const, status: 403, error: "Only the owning agency can rate this assignment." };
  if (assignment.status !== "COMPLETED") return { ok: false as const, status: 409, error: "Rate the editor after the assignment is completed." };
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false as const, status: 400, error: "Choose a rating from 1 to 5." };
  const metadata = (assignment.metadata && typeof assignment.metadata === "object" && !Array.isArray(assignment.metadata) ? assignment.metadata : {}) as Prisma.JsonObject;
  const updated = await prisma.appAssignmentRecord.update({ where: { id: assignment.id }, data: { metadata: { ...metadata, agencyRating: rating, agencyRatingNote: sanitizeText(input.note), agencyRatedAt: new Date().toISOString(), agencyRatedBy: actor.userId } } });
  await calculateFreelancerTrustScore(assignment.freelancerId);
  return { ok: true as const, assignment: updated };
}

export async function setAssignmentPerformanceContext(actor: AuthorizedActor, assignmentId: string, input: { effectiveDeadline?: unknown; delayAttribution?: unknown; excludedFromPerformance?: unknown; reason?: unknown }) {
  const assignment = await prisma.appAssignmentRecord.findUnique({ where: { id: assignmentId.trim() } });
  if (!assignment) return { ok: false as const, status: 404, error: "Assignment was not found." };
  if (!canManageTenant(actor, assignment.tenantId)) return { ok: false as const, status: 403, error: "Only the owning agency can record performance context." };
  const attributionInput = sanitizeText(input.delayAttribution).toUpperCase();
  const delayAttribution = attributionInput === "NONE" || !attributionInput ? null : attributionInput;
  if (delayAttribution && !["AGENCY", "CLIENT", "FREELANCER"].includes(delayAttribution)) return { ok: false as const, status: 400, error: "Choose agency, client, freelancer or no delay attribution." };
  const deadlineInput = sanitizeText(input.effectiveDeadline);
  const effectiveDeadline = deadlineInput ? new Date(deadlineInput) : null;
  if (effectiveDeadline && Number.isNaN(effectiveDeadline.getTime())) return { ok: false as const, status: 400, error: "Add a valid approved deadline." };
  const excludedFromPerformance = input.excludedFromPerformance === true;
  const reason = sanitizeText(input.reason);
  if ((effectiveDeadline || delayAttribution || excludedFromPerformance) && !reason) return { ok: false as const, status: 400, error: "Add the factual reason for this performance adjustment." };
  const context = await prisma.appAssignmentPerformanceContext.upsert({
    where: { assignmentId: assignment.id },
    create: { assignmentId: assignment.id, effectiveDeadline, delayAttribution, excludedFromPerformance, reason: reason || null, recordedByUserId: actor.userId },
    update: { effectiveDeadline, delayAttribution, excludedFromPerformance, reason: reason || null, recordedByUserId: actor.userId },
  });
  await calculateFreelancerTrustScore(assignment.freelancerId);
  return { ok: true as const, context };
}
