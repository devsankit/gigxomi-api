import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";
import type { DummyManagerAccount, DummyManagerPermissionKey, DummyManagerPermissionSet } from "@/lib/gigxomi/dummy-platform-store";

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
  if (!rawQueue) {
    return "General operations";
  }

  try {
    return decodeURIComponent(rawQueue) || "General operations";
  } catch {
    return rawQueue || "General operations";
  }
}

function decodeManagerPermissions(permissions: string[]) {
  const explicitPermissionEntries = permissions.filter((permission) => permission.startsWith(MANAGER_PERMISSION_PREFIX));
  const result = managerPermissionKeys.reduce((nextPermissions, key) => {
    nextPermissions[key] = explicitPermissionEntries.length
      ? explicitPermissionEntries.includes(`${MANAGER_PERMISSION_PREFIX}${key}`)
      : key === "chatInbox" || key === "assignedChats" || key === "deliveryReview" || key === "escalations";
    return nextPermissions;
  }, {} as DummyManagerPermissionSet);
  if (explicitPermissionEntries.includes(`${MANAGER_PERMISSION_PREFIX}teamEditors`)) result.assignedChats = true;
  if (explicitPermissionEntries.includes(`${MANAGER_PERMISSION_PREFIX}projectTracking`)) result.quoteReview = true;
  if (explicitPermissionEntries.includes(`${MANAGER_PERMISSION_PREFIX}workHub`)) result.deliveryReview = true;
  return result;
}

function encodeManagerPermissions(permissions: DummyManagerPermissionSet) {
  const list = managerPermissionKeys
    .filter((key) => Boolean(permissions[key]))
    .map((key) => `${MANAGER_PERMISSION_PREFIX}${key}`);
  if (permissions.assignedChats) list.push(`${MANAGER_PERMISSION_PREFIX}teamEditors`);
  if (permissions.quoteReview) list.push(`${MANAGER_PERMISSION_PREFIX}projectTracking`);
  if (permissions.deliveryReview) list.push(`${MANAGER_PERMISSION_PREFIX}workHub`);
  return Array.from(new Set(list));
}

function toManagerAccount(user: {
  id: string;
  tenantId: string | null;
  displayName: string;
  email: string | null;
  phone: string;
  permissions: string[];
}): DummyManagerAccount {
  return {
    id: user.id,
    tenantId: user.tenantId ?? "",
    authUserId: user.id,
    name: user.displayName,
    email: user.email ?? "",
    phone: user.phone,
    queue: decodeManagerQueue(user.permissions ?? []),
    active: true,
    permissions: decodeManagerPermissions(user.permissions ?? []),
  };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json();
  const tenantId =
    authorization.session.role === "SUPER_ADMIN"
      ? undefined
      : resolveSessionTenantId(authorization.session);
  const existing = await prisma.appAuthUser.findFirst({
    where: {
      id,
      role: "MANAGER",
      ...(tenantId?.trim() ? { tenantId: tenantId.trim() } : {}),
    },
  });

  if (!existing) {
    return NextResponse.json({ ok: false, error: "Manager not found" }, { status: 404 });
  }

  const existingPermissions = (existing.permissions ?? []) as string[];
  const currentPermissions = decodeManagerPermissions(existingPermissions);
  const nextPermissions = {
    ...currentPermissions,
    ...((body.permissions ?? {}) as Partial<DummyManagerPermissionSet>),
  };
  const nextPermissionEntries = encodeManagerPermissions(nextPermissions);
  const preservedEntries = existingPermissions.filter(
    (permission) => !permission.startsWith(MANAGER_PERMISSION_PREFIX),
  );
  const updated = await prisma.appAuthUser.update({
    where: { id: existing.id },
    data: {
      permissions: Array.from(new Set([...preservedEntries, ...nextPermissionEntries])),
    },
  });
  const manager = toManagerAccount(updated);

  return NextResponse.json({
    ok: true,
    manager,
  });
}
