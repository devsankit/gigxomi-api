import { NextResponse } from "next/server";

import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  getChannelConnectionByIdFromFile,
  saveChannelConnectionFromFile,
  deleteChannelConnectionFromFile,
  updateChannelConnectionNameFromFile,
  type ChannelConnection,
} from "@/lib/gigxomi/dummy-platform-file-store";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const connection = await getChannelConnectionByIdFromFile(id);
  if (!connection) {
    return NextResponse.json({ ok: false, error: "Channel connection not found" }, { status: 404 });
  }

  const sessionTenantId = resolveWhatsAppSetupTenantId(authorization.session);
  if (authorization.session.role !== "SUPER_ADMIN" && connection.tenantId !== sessionTenantId) {
    return NextResponse.json({ ok: false, error: "Access forbidden" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, connection });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const existing = await getChannelConnectionByIdFromFile(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Channel connection not found" }, { status: 404 });
  }

  const sessionTenantId = resolveWhatsAppSetupTenantId(authorization.session);
  if (authorization.session.role !== "SUPER_ADMIN" && existing.tenantId !== sessionTenantId) {
    return NextResponse.json({ ok: false, error: "Access forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const nextDisplayName = text(body.displayName);
  const nextStatus = text(body.status);
  const isDefault = body.isDefault !== undefined ? Boolean(body.isDefault) : undefined;

  let current = existing;
  if (nextDisplayName && nextDisplayName !== current.displayName) {
    const updated = await updateChannelConnectionNameFromFile(id, nextDisplayName);
    if (updated) current = updated;
  }

  const needsDirectUpdate =
    (nextStatus && nextStatus !== current.status) ||
    (isDefault !== undefined && isDefault !== current.isDefault) ||
    body.phoneNumber !== undefined ||
    body.accountHandle !== undefined ||
    body.accessToken !== undefined;

  if (needsDirectUpdate) {
    const updatedConn: ChannelConnection = {
      ...current,
      status: (nextStatus === "ACTIVE" || nextStatus === "DISCONNECTED" ? nextStatus : current.status),
      isDefault: isDefault !== undefined ? isDefault : current.isDefault,
      phoneNumber: body.phoneNumber !== undefined ? text(body.phoneNumber) : current.phoneNumber,
      accountHandle: body.accountHandle !== undefined ? text(body.accountHandle) : current.accountHandle,
      accessToken: body.accessToken !== undefined ? text(body.accessToken) : current.accessToken,
      updatedAt: new Date().toISOString(),
    };
    current = await saveChannelConnectionFromFile(updatedConn);
  }

  return NextResponse.json({ ok: true, connection: current });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const existing = await getChannelConnectionByIdFromFile(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Channel connection not found" }, { status: 404 });
  }

  const sessionTenantId = resolveWhatsAppSetupTenantId(authorization.session);
  if (authorization.session.role !== "SUPER_ADMIN" && existing.tenantId !== sessionTenantId) {
    return NextResponse.json({ ok: false, error: "Access forbidden" }, { status: 403 });
  }

  const deleted = await deleteChannelConnectionFromFile(id);
  return NextResponse.json({ ok: true, deleted });
}
