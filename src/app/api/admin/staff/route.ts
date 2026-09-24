import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";
import { parseInHouseSettings } from "@/lib/team/inhouse-editor-policy";
import type { DummyManagerPermissionKey, DummyManagerPermissionSet } from "@/lib/gigxomi/dummy-platform-store";

const MANAGER_QUEUE_PREFIX = "manager_queue:";
const MANAGER_PERMISSION_PREFIX = "manager_permission:";
const managerPermissionKeys: DummyManagerPermissionKey[] = [
  "chatInbox",
  "assignedChats",
  "quoteReview",
  "deliveryReview",
  "walletReview",
  "escalations",
  "allContacts",
];

function decodeManagerQueue(permissions: string[]) {
  const rawQueue = permissions.find((permission) => permission.startsWith(MANAGER_QUEUE_PREFIX))?.slice(MANAGER_QUEUE_PREFIX.length) ?? "";
  if (!rawQueue) return "General operations";
  try {
    return decodeURIComponent(rawQueue) || "General operations";
  } catch {
    return rawQueue || "General operations";
  }
}

function decodeManagerPermissions(permissions: string[]): DummyManagerPermissionSet {
  const defaults: DummyManagerPermissionSet = {
    chatInbox: true,
    assignedChats: true,
    quoteReview: false,
    deliveryReview: true,
    walletReview: false,
    escalations: true,
    allContacts: false,
  };
  const explicit = permissions.filter((p) => p.startsWith(MANAGER_PERMISSION_PREFIX));
  if (!explicit.length) return defaults;
  const result = managerPermissionKeys.reduce((acc, key) => {
    acc[key] = explicit.includes(`${MANAGER_PERMISSION_PREFIX}${key}`);
    return acc;
  }, {} as DummyManagerPermissionSet);
  if (explicit.includes(`${MANAGER_PERMISSION_PREFIX}teamEditors`)) result.assignedChats = true;
  if (explicit.includes(`${MANAGER_PERMISSION_PREFIX}projectTracking`)) result.quoteReview = true;
  if (explicit.includes(`${MANAGER_PERMISSION_PREFIX}workHub`)) result.deliveryReview = true;
  return result;
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const tenantId = resolveSessionTenantId(authorization.session) || authorization.session.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Missing agency tenant context." }, { status: 400 });
  }

  // 1. Fetch managers
  const managerUsers = await prisma.appAuthUser.findMany({
    where: {
      role: "MANAGER",
      tenantId,
    },
    select: {
      id: true,
      displayName: true,
      email: true,
      phone: true,
      permissions: true,
      createdAt: true,
      lastLoginAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const managers = managerUsers.map((u) => ({
    id: u.id,
    name: u.displayName,
    email: u.email || "",
    phone: u.phone,
    queue: decodeManagerQueue((u.permissions as string[]) ?? []),
    active: !((u.permissions as string[]) ?? []).includes("manager_status:paused"),
    permissions: decodeManagerPermissions((u.permissions as string[]) ?? []),
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  }));

  // 2. Fetch active in-house team memberships
  const memberships = await prisma.appTeamMembership.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });

  const freelancerIds = memberships.map((m) => m.freelancerId);
  const freelancerUsers = await prisma.appAuthUser.findMany({
    where: { id: { in: freelancerIds } },
    select: {
      id: true,
      displayName: true,
      phone: true,
      email: true,
      lastLoginAt: true,
      freelancerWorkspace: { select: { profile: true } },
    },
  });

  const userMap = new Map(freelancerUsers.map((u) => [u.id, u]));

  const inhouseEditors = memberships.map((m) => {
    const user = userMap.get(m.freelancerId);
    const inHouseSettings = parseInHouseSettings(m.permissions, m.metadata);
    const profile = (user?.freelancerWorkspace?.profile as Record<string, unknown>) ?? {};

    return {
      id: m.id,
      membershipId: m.id,
      freelancerId: m.freelancerId,
      name: (profile.displayName as string) || (profile.fullName as string) || user?.displayName || m.freelancerName,
      phone: user?.phone || "",
      email: user?.email || null,
      roleType: m.roleType || "Video editor",
      status: m.status,
      inHouseSettings,
      joinedAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  });

  // 3. Fetch pending requests
  const pendingRequests = await prisma.appTeamRequest.findMany({
    where: {
      tenantId,
      status: { in: ["SENT", "PENDING"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const pendingInvites = pendingRequests.map((r) => ({
    id: r.id,
    freelancerId: r.freelancerId,
    name: r.freelancerName,
    roleType: r.roleType,
    status: r.status,
    message: r.message,
    inHouseSettings: parseInHouseSettings(r.permissions, r.metadata),
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
  }));

  return NextResponse.json({
    ok: true,
    tenantId,
    counts: {
      managers: managers.length,
      inhouseEditors: inhouseEditors.length,
      restrictedEditors: inhouseEditors.filter((e) => e.inHouseSettings.exclusiveAgencyOnly || !e.inHouseSettings.canCreateGigs).length,
      pendingInvites: pendingInvites.length,
    },
    managers,
    inhouseEditors,
    pendingInvites,
  });
}
