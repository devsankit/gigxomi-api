import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { normalizePhone } from "@/lib/auth/normalize";
import { createInternalUser, findUserByIdentifier } from "@/lib/auth/store";
import { assertPlanLimit, getEffectiveBillingPackageForUser } from "@/lib/billing/billing-access-service";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth/types";
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

type ManagerUserRow = {
  id: string;
  tenantId: string | null;
  displayName: string;
  email: string | null;
  phone: string;
  permissions: string[] | null;
};

function getDefaultManagerPermissions(): DummyManagerPermissionSet {
  return {
    chatInbox: true,
    assignedChats: true,
    quoteReview: false,
    deliveryReview: true,
    walletReview: false,
    escalations: true,
    allContacts: false,
  };
}

function encodeManagerQueue(queue: string) {
  return `${MANAGER_QUEUE_PREFIX}${encodeURIComponent(queue.trim() || "General operations")}`;
}

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

function encodeManagerPermissions(permissions: DummyManagerPermissionSet) {
  const list = managerPermissionKeys
    .filter((key) => Boolean(permissions[key]))
    .map((key) => `${MANAGER_PERMISSION_PREFIX}${key}`);
  if (permissions.assignedChats) list.push(`${MANAGER_PERMISSION_PREFIX}teamEditors`);
  if (permissions.quoteReview) list.push(`${MANAGER_PERMISSION_PREFIX}projectTracking`);
  if (permissions.deliveryReview) list.push(`${MANAGER_PERMISSION_PREFIX}workHub`);
  return Array.from(new Set(list));
}

function decodeManagerPermissions(permissions: string[]) {
  const defaults = getDefaultManagerPermissions();
  const explicitPermissionEntries = permissions.filter((permission) => permission.startsWith(MANAGER_PERMISSION_PREFIX));
  if (!explicitPermissionEntries.length) {
    return defaults;
  }

  const result = managerPermissionKeys.reduce((nextPermissions, key) => {
    nextPermissions[key] = explicitPermissionEntries.includes(`${MANAGER_PERMISSION_PREFIX}${key}`);
    return nextPermissions;
  }, {} as DummyManagerPermissionSet);
  if (explicitPermissionEntries.includes(`${MANAGER_PERMISSION_PREFIX}teamEditors`)) result.assignedChats = true;
  if (explicitPermissionEntries.includes(`${MANAGER_PERMISSION_PREFIX}projectTracking`)) result.quoteReview = true;
  if (explicitPermissionEntries.includes(`${MANAGER_PERMISSION_PREFIX}workHub`)) result.deliveryReview = true;
  return result;
}

function buildManagerPermissionPayload(input: { queue: string; permissions?: DummyManagerPermissionSet }) {
  return [
    "manager",
    encodeManagerQueue(input.queue),
    ...encodeManagerPermissions(input.permissions ?? getDefaultManagerPermissions()),
  ];
}

async function listManagersFromDb(tenantId?: string) {
  const users = (await prisma.appAuthUser.findMany({
    where: {
      role: "MANAGER",
      ...(tenantId?.trim() ? { tenantId: tenantId.trim() } : {}),
    },
    orderBy: { createdAt: "desc" },
  })) as ManagerUserRow[];

  return users.map((user) => {
    const permissions = user.permissions ?? [];
    return {
      id: user.id,
      tenantId: user.tenantId ?? "",
      authUserId: user.id,
      name: user.displayName,
      email: user.email ?? "",
      phone: user.phone,
      queue: decodeManagerQueue(permissions),
      active: true,
      permissions: decodeManagerPermissions(permissions),
    };
  }) satisfies DummyManagerAccount[];
}

async function createManagerAuthUser(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
  tenantId?: string;
  createdByUserId: string;
}) {
  const existingAuthUser = await findUserByIdentifier(input.email);
  if (existingAuthUser) {
    return { ok: false as const, error: "An account already exists with that email." };
  }

  const normalizedPhone = normalizePhone(input.phone);
  const existingPhoneUser = normalizedPhone ? await findUserByIdentifier(normalizedPhone) : null;
  if (existingPhoneUser) {
    return { ok: false as const, error: "An account already exists with that WhatsApp number." };
  }

  let lastError = "Unable to create manager login.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await createInternalUser({
      role: "MANAGER",
      displayName: input.name,
      email: input.email,
      phone: normalizedPhone,
      password: input.password,
      tenantId: input.tenantId,
      createdByUserId: input.createdByUserId,
    });

    if (result.ok) {
      return result;
    }

    lastError = result.error;
    if (!result.error.toLowerCase().includes("email or phone")) {
      break;
    }
  }

  return { ok: false as const, error: lastError };
}

async function buildManagerLimitState(session: SessionUser, activeManagers: number) {
  if (session.role === "SUPER_ADMIN") {
    return {
      activeManagers,
      canCreateManager: true,
      limitSource: "super_admin_override",
      managerSeatLimit: null,
      packageName: "Super admin override",
      reason: null,
    };
  }

  const effectivePackage = await getEffectiveBillingPackageForUser(session.userId).catch(() => null);
  if (!effectivePackage?.package) {
    return {
      activeManagers,
      canCreateManager: false,
      limitSource: "package",
      managerSeatLimit: 0,
      packageName: session.packageName ?? null,
      reason: "Active agency package required.",
    };
  }

  const rawLimit = effectivePackage.package.staffAccountLimit;
  const managerSeatLimit = typeof rawLimit === "number" && rawLimit >= 0 ? rawLimit : null;
  return {
    activeManagers,
    canCreateManager: managerSeatLimit === null || activeManagers < managerSeatLimit,
    limitSource: "package",
    managerSeatLimit,
    packageName: effectivePackage.package.name,
    reason: managerSeatLimit !== null && activeManagers >= managerSeatLimit ? "Manager seat package limit reached." : null,
  };
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const tenantId =
    authorization.session.role === "SUPER_ADMIN"
      ? undefined
      : resolveSessionTenantId(authorization.session);

  const managers = await listManagersFromDb(tenantId);
  const limits = await buildManagerLimitState(
    authorization.session,
    managers.filter((manager) => manager.active).length,
  );

  return NextResponse.json({
    ok: true,
    limits,
    managers,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const tenantId =
    authorization.session.role === "SUPER_ADMIN"
      ? undefined
      : resolveSessionTenantId(authorization.session);

  const body = await request.json();
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = normalizePhone(String(body.phone ?? "").trim());
  const password = String(body.password ?? "").trim();
  const queue = String(body.queue ?? "").trim();

  if (!name) {
    return NextResponse.json({ ok: false, error: "Manager name is required." }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, error: "Enter a valid manager email." }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Enter a valid manager WhatsApp number." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(password)) {
    return NextResponse.json({ ok: false, error: "Manager PIN must be exactly 6 digits." }, { status: 400 });
  }

  const existingManagers = await listManagersFromDb(tenantId);
  if (authorization.session.role !== "SUPER_ADMIN") {
    const limit = await assertPlanLimit({
      userId: authorization.session.userId,
      limitKey: "staffAccountLimit",
      currentCount: existingManagers.filter((manager) => manager.active).length,
      label: "Manager seat",
    });
    if (!limit.ok) {
      return NextResponse.json({ ok: false, error: limit.error, limit: "limit" in limit ? limit.limit : undefined }, { status: 402 });
    }
  }

  const authUser = await createManagerAuthUser({
    name,
    email,
    phone,
    password,
    tenantId,
    createdByUserId: authorization.session.userId,
  });
  if (!authUser.ok) {
    return NextResponse.json({ ok: false, error: authUser.error }, { status: 409 });
  }

  await prisma.appAuthUser.update({
    where: { id: authUser.user.id },
    data: {
      permissions: buildManagerPermissionPayload({
        queue,
        permissions: getDefaultManagerPermissions(),
      }),
    },
  });

  const managers = await listManagersFromDb(tenantId);
  const manager = managers.find((nextManager) => nextManager.id === authUser.user.id) ?? null;

  return NextResponse.json({
    ok: true,
    limits: await buildManagerLimitState(
      authorization.session,
      managers.filter((nextManager) => nextManager.active).length,
    ),
    manager,
    managers,
  });
}
