import "server-only";

import { listConversationsForAudienceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { prisma } from "@/lib/prisma";

export const FREEMIUM_EDITOR_LIMIT = 2;

const assignmentCapacityLocks = new Map<string, Promise<void>>();

export async function withAssignmentCapacityLock<T>(tenantId: string, action: () => Promise<T>) {
  const key = tenantId.trim() || "unknown";
  const previous = assignmentCapacityLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  assignmentCapacityLocks.set(key, tail);
  await previous.catch(() => undefined);

  try {
    return await action();
  } finally {
    release();
    if (assignmentCapacityLocks.get(key) === tail) assignmentCapacityLocks.delete(key);
  }
}

type TeamLimitResult =
  | { ok: true; activeSeats: number; limit: number | null; remaining: number | null }
  | { ok: false; activeSeats: number; error: string; limit: number | null; remaining: number | null };

function normalizeLimit(value: number | null | undefined) {
  return typeof value === "number" && value > 0 ? value : null;
}

export async function getPackageEditorLimit(packageId?: string | null) {
  if (!packageId?.trim()) return FREEMIUM_EDITOR_LIMIT;

  const pkg = await prisma.package.findFirst({
    where: { OR: [{ id: packageId.trim() }, { slug: packageId.trim() }] },
    select: { editorFreelancerLimit: true, teamMemberLimit: true },
  });

  if (!pkg) return FREEMIUM_EDITOR_LIMIT;
  return normalizeLimit(pkg.editorFreelancerLimit ?? pkg.teamMemberLimit);
}

const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "REVISION_REQUESTED"];

export async function getActiveAssignedEditorIds(tenantId: string) {
  const [conversationPayload, assignments] = await Promise.all([
    listConversationsForAudienceFromFile("admin", { tenantId, includeSupportData: false }),
    prisma.appAssignmentRecord.findMany({
      where: { tenantId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
      select: { freelancerId: true },
    }),
  ]);

  return new Set(
    [
      ...conversationPayload.conversations
        .filter((conversation) => conversation.status.toLowerCase() !== "closed")
        .map((conversation) => conversation.assignmentSummary?.assignedFreelancerId ?? conversation.assignedFreelancerId ?? ""),
      ...assignments.map((assignment) => assignment.freelancerId),
    ].filter(Boolean),
  );
}

export async function assertActiveAssignmentEditorLimit(input: {
  tenantId: string;
  packageId?: string | null;
  editorIds?: string[];
}): Promise<TeamLimitResult> {
  const limit = await getPackageEditorLimit(input.packageId);
  const activeEditorIds = await getActiveAssignedEditorIds(input.tenantId);
  const activeSeats = activeEditorIds.size;

  if (!limit) return { ok: true, activeSeats, limit, remaining: null };

  const requestedEditorIds = Array.from(new Set((input.editorIds ?? []).map((id) => id.trim()).filter(Boolean)));
  const requestedNewEditors = requestedEditorIds.filter((editorId) => !activeEditorIds.has(editorId));
  if (!requestedNewEditors.length) {
    return { ok: true, activeSeats, limit, remaining: Math.max(0, limit - activeSeats) };
  }

  if (activeSeats >= limit) {
    return {
      ok: false,
      activeSeats,
      limit,
      remaining: 0,
      error: `Your Freemium workspace already has ${limit} distinct editors on active work. Close or unassign work from one editor, or upgrade to Premium.`,
    };
  }

  return { ok: true, activeSeats, limit, remaining: limit - activeSeats };
}

// Kept as an internal compatibility alias while callers migrate from the old
// team-seat interpretation to the active-assignment rule.
export const assertTeamEditorLimit = assertActiveAssignmentEditorLimit;
