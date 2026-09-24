import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { normalizePhone } from "@/lib/auth/normalize";
import { hashPassword } from "@/lib/auth/store";
import { prisma } from "@/lib/prisma";
import {
  parseInHouseSettings,
  encodeInHousePermissions,
  type InHouseEditorSettings,
} from "@/lib/team/inhouse-editor-policy";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const tenantId = resolveSessionTenantId(authorization.session) || authorization.session.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Missing agency tenant context." }, { status: 400 });
  }

  const { id } = await context.params;

  const membership = await prisma.appTeamMembership.findFirst({
    where: {
      tenantId,
      OR: [{ id }, { freelancerId: id }],
    },
  });

  if (!membership) {
    return NextResponse.json({ ok: false, error: "Editor membership not found." }, { status: 404 });
  }

  const user = await prisma.appAuthUser.findUnique({
    where: { id: membership.freelancerId },
    select: {
      id: true,
      displayName: true,
      email: true,
      phone: true,
      createdAt: true,
      lastLoginAt: true,
      freelancerWorkspace: { select: { profile: true } },
    },
  });

  const profile = (user?.freelancerWorkspace?.profile as Record<string, unknown>) ?? {};
  const inHouseSettings = parseInHouseSettings(membership.permissions, membership.metadata);

  return NextResponse.json({
    ok: true,
    editor: {
      id: membership.id,
      membershipId: membership.id,
      freelancerId: membership.freelancerId,
      name: (profile.displayName as string) || (profile.fullName as string) || user?.displayName || membership.freelancerName,
      phone: user?.phone || "",
      email: user?.email || null,
      roleType: membership.roleType || "In-house Video Editor",
      status: membership.status,
      inHouseSettings,
      joinedAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
      lastLoginAt: user?.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const tenantId = resolveSessionTenantId(authorization.session) || authorization.session.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Missing agency tenant context." }, { status: 400 });
  }

  const { id } = await context.params;

  const membership = await prisma.appTeamMembership.findFirst({
    where: {
      tenantId,
      OR: [{ id }, { freelancerId: id }],
      status: "ACTIVE",
    },
  });

  if (!membership) {
    return NextResponse.json({ ok: false, error: "Active team editor membership not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const rawRoleType = typeof body.roleType === "string" ? body.roleType.trim() : "";
  const rawPhone = typeof body.phone === "string" ? normalizePhone(body.phone.trim()) : "";
  const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  // 1. If phone or email are provided, check for conflicts on AppAuthUser
  if (rawPhone && rawPhone.length >= 10) {
    const existingPhoneUser = await prisma.appAuthUser.findFirst({
      where: {
        id: { not: membership.freelancerId },
        OR: [{ phone: rawPhone }, { loginPhoneAliases: { has: rawPhone } }],
      },
    });
    if (existingPhoneUser) {
      return NextResponse.json({ ok: false, error: "Another user account is already using that phone number." }, { status: 409 });
    }
  }

  if (rawEmail && rawEmail.includes("@")) {
    const existingEmailUser = await prisma.appAuthUser.findFirst({
      where: {
        id: { not: membership.freelancerId },
        email: rawEmail,
      },
    });
    if (existingEmailUser) {
      return NextResponse.json({ ok: false, error: "Another user account is already using that email address." }, { status: 409 });
    }
  }

  // 2. Update user profile fields if changed
  const userUpdates: Record<string, unknown> = {};
  if (rawName) userUpdates.displayName = rawName;
  if (rawPhone && rawPhone.length >= 10) {
    userUpdates.phone = rawPhone;
    userUpdates.loginPhoneAliases = [rawPhone];
  }
  if (rawEmail && rawEmail.includes("@")) {
    userUpdates.email = rawEmail;
  }

  const rawPassword = typeof body.password === "string" ? body.password.trim() : typeof body.pin === "string" ? body.pin.trim() : "";
  if (rawPassword) {
    const salt = randomBytes(16).toString("hex");
    userUpdates.passwordSalt = salt;
    userUpdates.passwordHash = hashPassword(rawPassword, salt);
    userUpdates.otpCode = rawPassword;
  }

  if (Object.keys(userUpdates).length > 0) {
    await prisma.appAuthUser.update({
      where: { id: membership.freelancerId },
      data: userUpdates,
    });
  }

  // 3. Process in-house settings / permissions
  const currentSettings = parseInHouseSettings(membership.permissions, membership.metadata);
  const incomingSettings = (body.inHouseSettings && typeof body.inHouseSettings === "object" ? body.inHouseSettings : {}) as Partial<InHouseEditorSettings>;

  const nextSettings: InHouseEditorSettings = {
    exclusiveAgencyOnly: incomingSettings.exclusiveAgencyOnly !== undefined ? Boolean(incomingSettings.exclusiveAgencyOnly) : currentSettings.exclusiveAgencyOnly,
    marketplaceVisible: incomingSettings.marketplaceVisible !== undefined ? Boolean(incomingSettings.marketplaceVisible) : currentSettings.marketplaceVisible,
    canCreateGigs: incomingSettings.canCreateGigs !== undefined ? Boolean(incomingSettings.canCreateGigs) : currentSettings.canCreateGigs,
    canSendCustomerMessage: incomingSettings.canSendCustomerMessage !== undefined ? Boolean(incomingSettings.canSendCustomerMessage) : currentSettings.canSendCustomerMessage,
    directClientDelivery: incomingSettings.directClientDelivery !== undefined ? Boolean(incomingSettings.directClientDelivery) : currentSettings.directClientDelivery,
  };

  const nextPermissions = encodeInHousePermissions(nextSettings);
  const existingMeta = (membership.metadata as Record<string, unknown>) ?? {};

  // 4. Update team membership
  const updatedMembership = await prisma.appTeamMembership.update({
    where: { id: membership.id },
    data: {
      freelancerName: rawName || membership.freelancerName,
      roleType: rawRoleType || membership.roleType,
      permissions: nextPermissions,
      metadata: {
        ...existingMeta,
        inHouseSettings: nextSettings,
        lastUpdatedByUserId: authorization.session.userId,
        lastUpdatedAt: new Date().toISOString(),
      },
    },
  });

  return NextResponse.json({
    ok: true,
    message: "Editor details and controls updated successfully.",
    editor: {
      id: updatedMembership.id,
      membershipId: updatedMembership.id,
      freelancerId: updatedMembership.freelancerId,
      name: rawName || updatedMembership.freelancerName,
      phone: rawPhone || "",
      email: rawEmail || null,
      roleType: updatedMembership.roleType,
      status: updatedMembership.status,
      inHouseSettings: nextSettings,
      updatedAt: updatedMembership.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const tenantId = resolveSessionTenantId(authorization.session) || authorization.session.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Missing agency tenant context." }, { status: 400 });
  }

  const { id } = await context.params;

  // Find membership by membership ID or by freelancerId
  const membership = await prisma.appTeamMembership.findFirst({
    where: {
      tenantId,
      OR: [{ id }, { freelancerId: id }],
      status: "ACTIVE",
    },
  });

  if (!membership) {
    return NextResponse.json({ ok: false, error: "Team editor membership not found." }, { status: 404 });
  }

  // Remove editor by marking status as SUSPENDED and setting removedAt
  const updated = await prisma.appTeamMembership.update({
    where: { id: membership.id },
    data: {
      status: "SUSPENDED",
      removedAt: new Date(),
      metadata: {
        ...((membership.metadata as Record<string, unknown>) ?? {}),
        removedByUserId: authorization.session.userId,
        removedAt: new Date().toISOString(),
      },
    },
  });

  // Immediately deactivate their appAuthUser login credentials for this tenant if present
  if (membership.freelancerId) {
    await prisma.appAuthUser.updateMany({
      where: { id: membership.freelancerId, tenantId },
      data: { status: "INACTIVE" },
    }).catch(() => null);
  }

  return NextResponse.json({
    ok: true,
    membershipId: updated.id,
    freelancerId: updated.freelancerId,
    message: "Editor successfully removed from agency team.",
  });
}
