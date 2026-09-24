import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";
import {
  parseInHouseSettings,
  encodeInHousePermissions,
  type InHouseEditorSettings,
} from "@/lib/team/inhouse-editor-policy";

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
  const body = await request.json().catch(() => ({}));

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

  const currentSettings = parseInHouseSettings(membership.permissions, membership.metadata);
  const incoming: Partial<InHouseEditorSettings> =
    body.inHouseSettings && typeof body.inHouseSettings === "object"
      ? body.inHouseSettings
      : body && typeof body === "object"
      ? body
      : {};

  const nextSettings: InHouseEditorSettings = {
    exclusiveAgencyOnly: incoming.exclusiveAgencyOnly !== undefined ? Boolean(incoming.exclusiveAgencyOnly) : currentSettings.exclusiveAgencyOnly,
    marketplaceVisible: incoming.marketplaceVisible !== undefined ? Boolean(incoming.marketplaceVisible) : currentSettings.marketplaceVisible,
    canCreateGigs: incoming.canCreateGigs !== undefined ? Boolean(incoming.canCreateGigs) : currentSettings.canCreateGigs,
    canSendCustomerMessage: incoming.canSendCustomerMessage !== undefined ? Boolean(incoming.canSendCustomerMessage) : currentSettings.canSendCustomerMessage,
    directClientDelivery: incoming.directClientDelivery !== undefined ? Boolean(incoming.directClientDelivery) : currentSettings.directClientDelivery,
  };

  const nextPermissions = encodeInHousePermissions(nextSettings);
  const existingMeta = (membership.metadata as Record<string, unknown>) ?? {};

  const updated = await prisma.appTeamMembership.update({
    where: { id: membership.id },
    data: {
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
    membershipId: updated.id,
    freelancerId: updated.freelancerId,
    inHouseSettings: nextSettings,
    permissions: updated.permissions,
  });
}
