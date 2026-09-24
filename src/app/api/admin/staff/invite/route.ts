import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { normalizePhone } from "@/lib/auth/normalize";
import { createInternalUser, findUserByIdentifier, hashPassword } from "@/lib/auth/store";
import { prisma } from "@/lib/prisma";
import {
  encodeInHousePermissions,
  isEditorRestrictedForExternalAgency,
  DEFAULT_INHOUSE_SETTINGS,
  type InHouseEditorSettings,
} from "@/lib/team/inhouse-editor-policy";
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

function encodeManagerQueue(queue: string) {
  return `${MANAGER_QUEUE_PREFIX}${encodeURIComponent(queue.trim() || "General operations")}`;
}

function encodeManagerPermissions(permissions: DummyManagerPermissionSet) {
  return managerPermissionKeys
    .filter((key) => Boolean(permissions[key]))
    .map((key) => `${MANAGER_PERMISSION_PREFIX}${key}`);
}

function makeId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const tenantId = resolveSessionTenantId(authorization.session) || authorization.session.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Missing agency tenant context." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const role = String(body.role || "").toUpperCase();

  if (role !== "MANAGER" && role !== "FREELANCER") {
    return NextResponse.json({ ok: false, error: "Select a valid staff role: Manager or Freelancer." }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  const phone = normalizePhone(String(body.phone || "").trim());
  const email = String(body.email || "").trim().toLowerCase();

  if (!name) {
    return NextResponse.json({ ok: false, error: "Staff member name is required." }, { status: 400 });
  }
  if (!phone || phone.length < 10) {
    return NextResponse.json({ ok: false, error: "Valid 10-digit WhatsApp phone number is required." }, { status: 400 });
  }

  // ==========================================
  // 1. MANAGER ROLE CREATION
  // ==========================================
  if (role === "MANAGER") {
    const password = String(body.pin || body.password || "").trim();
    if (!/^\d{6}$/.test(password)) {
      return NextResponse.json({ ok: false, error: "Manager PIN must be exactly 6 numeric digits (e.g. 123456)." }, { status: 400 });
    }

    const queue = String(body.queue || "General operations").trim();
    const assignedChats = Boolean(body.managerPermissions?.assignedChats ?? body.managerPermissions?.teamEditors ?? true);
    const quoteReview = Boolean(body.managerPermissions?.quoteReview ?? body.managerPermissions?.projectTracking ?? true);
    const deliveryReview = Boolean(body.managerPermissions?.deliveryReview ?? body.managerPermissions?.workHub ?? true);

    const mgrPerms: DummyManagerPermissionSet = {
      chatInbox: Boolean(body.managerPermissions?.chatInbox ?? true),
      assignedChats,
      quoteReview,
      deliveryReview,
      walletReview: Boolean(body.managerPermissions?.walletReview ?? false),
      escalations: Boolean(body.managerPermissions?.escalations ?? true),
      allContacts: Boolean(body.managerPermissions?.allContacts ?? false),
    };

    const permissions = [
      "manager",
      encodeManagerQueue(queue),
      ...encodeManagerPermissions(mgrPerms),
      ...(assignedChats ? ["manager_permission:teamEditors"] : []),
      ...(quoteReview ? ["manager_permission:projectTracking"] : []),
      ...(deliveryReview ? ["manager_permission:workHub"] : []),
    ];

    const normalizedPhone = normalizePhone(phone);
    const existingUser = await prisma.appAuthUser.findFirst({
      where: {
        OR: [
          { phone: normalizedPhone },
          { loginPhoneAliases: { has: normalizedPhone } },
          ...(email ? [{ email }] : []),
        ],
      },
    });

    if (existingUser) {
      const salt = randomBytes(16).toString("hex");
      const updatedUser = await prisma.appAuthUser.update({
        where: { id: existingUser.id },
        data: {
          role: "MANAGER",
          assignedRole: "MANAGER",
          tenantId,
          displayName: name,
          phone: normalizedPhone,
          passwordSalt: salt,
          passwordHash: hashPassword(password, salt),
          otpCode: password,
          permissions,
        },
      });

      return NextResponse.json({
        ok: true,
        role: "MANAGER",
        message: `Manager ${name} assigned successfully (credentials updated).`,
        user: updatedUser,
      });
    }

    const result = await createInternalUser({
      role: "MANAGER",
      displayName: name,
      email: email || `${phone.replace(/\D/g, "")}@gigxomi.local`,
      phone: normalizedPhone,
      password,
      tenantId,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    await prisma.appAuthUser.update({
      where: { id: result.user.id },
      data: { permissions },
    });

    return NextResponse.json({
      ok: true,
      role: "MANAGER",
      message: `Manager ${name} created successfully.`,
      user: result.user,
    });
  }

  // ==========================================
  // 2. FREELANCER (IN-HOUSE EDITOR) ASSIGNMENT
  // ==========================================
  const inHouseInput: Partial<InHouseEditorSettings> = body.inHouseSettings || {};
  const inHouseSettings: InHouseEditorSettings = {
    exclusiveAgencyOnly: inHouseInput.exclusiveAgencyOnly !== undefined ? Boolean(inHouseInput.exclusiveAgencyOnly) : DEFAULT_INHOUSE_SETTINGS.exclusiveAgencyOnly,
    marketplaceVisible: inHouseInput.marketplaceVisible !== undefined ? Boolean(inHouseInput.marketplaceVisible) : DEFAULT_INHOUSE_SETTINGS.marketplaceVisible,
    canCreateGigs: inHouseInput.canCreateGigs !== undefined ? Boolean(inHouseInput.canCreateGigs) : DEFAULT_INHOUSE_SETTINGS.canCreateGigs,
    canSendCustomerMessage: inHouseInput.canSendCustomerMessage !== undefined ? Boolean(inHouseInput.canSendCustomerMessage) : DEFAULT_INHOUSE_SETTINGS.canSendCustomerMessage,
    directClientDelivery: inHouseInput.directClientDelivery !== undefined ? Boolean(inHouseInput.directClientDelivery) : DEFAULT_INHOUSE_SETTINGS.directClientDelivery,
  };

  const rawPassword = String(body.password || body.pin || "").trim();

  // Find or create freelancer account
  let freelancerUser = await findUserByIdentifier(phone);
  if (!freelancerUser && email) {
    freelancerUser = await findUserByIdentifier(email);
  }

  if (!freelancerUser) {
    // Create new freelancer user so they can login via password or OTP immediately
    const createdUser = await createInternalUser({
      role: "FREELANCER",
      displayName: name,
      phone,
      email: email || `${phone.replace(/\D/g, "")}@gigxomi.local`,
      password: rawPassword || randomBytes(12).toString("hex"),
      tenantId: null,
    });

    if (!createdUser.ok) {
      return NextResponse.json({ ok: false, error: createdUser.error }, { status: 400 });
    }
    freelancerUser = createdUser.user;

    if (rawPassword) {
      await prisma.appAuthUser.update({
        where: { id: freelancerUser.id },
        data: { otpCode: rawPassword },
      });
    }
  } else if (rawPassword || email) {
    const salt = randomBytes(16).toString("hex");
    await prisma.appAuthUser.update({
      where: { id: freelancerUser.id },
      data: {
        ...(email ? { email } : {}),
        ...(rawPassword
          ? {
              passwordSalt: salt,
              passwordHash: hashPassword(rawPassword, salt),
              otpCode: rawPassword,
            }
          : {}),
      },
    });
  }

  // Check if already in another agency's exclusive in-house team
  const restriction = await isEditorRestrictedForExternalAgency(freelancerUser.id, tenantId);
  if (restriction.restricted) {
    return NextResponse.json({
      ok: false,
      error: restriction.reason || "This editor is an exclusive in-house team member of another agency.",
    }, { status: 409 });
  }

  const encodedPerms = encodeInHousePermissions(inHouseSettings);
  const roleType = String(body.roleType || "In-house Video Editor").trim();
  const agencyName = authorization.session.displayName || "Agency";

  // Upsert active team membership for this agency
  const membership = await prisma.appTeamMembership.upsert({
    where: {
      tenantId_freelancerId: {
        tenantId,
        freelancerId: freelancerUser.id,
      },
    },
    create: {
      id: makeId("team-member"),
      tenantId,
      agencyUserId: authorization.session.userId,
      agencyName,
      freelancerId: freelancerUser.id,
      freelancerName: name,
      roleType,
      permissions: encodedPerms,
      status: "ACTIVE",
      metadata: {
        inHouseSettings,
        assignedByUserId: authorization.session.userId,
        assignedAt: new Date().toISOString(),
      },
    },
    update: {
      freelancerName: name,
      roleType,
      permissions: encodedPerms,
      status: "ACTIVE",
      removedAt: null,
      metadata: {
        inHouseSettings,
        assignedByUserId: authorization.session.userId,
        assignedAt: new Date().toISOString(),
      },
    },
  });

  return NextResponse.json({
    ok: true,
    role: "FREELANCER",
    message: `Editor ${name} assigned as in-house staff successfully.`,
    membership,
    inHouseSettings,
  });
}
