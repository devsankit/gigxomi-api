import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  ensureInstagramConnectionDraftFromFile,
  getInstagramConnectionStateFromFile,
  updateInstagramConnectionStateFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import type { DummyInstagramConnectionState } from "@/lib/gigxomi/dummy-platform-store";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function redactConnection(connection: DummyInstagramConnectionState | null, canViewToken: boolean) {
  if (!connection) return null;
  const envToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim() || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN?.trim() || "";
  const effectiveToken = connection.accessToken || envToken;
  return {
    ...connection,
    accessToken: canViewToken ? effectiveToken : "",
    hasAccessToken: Boolean(effectiveToken),
  };
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) return authorization.response;
  const tenantId = resolveSessionTenantId(authorization.session, new URL(request.url).searchParams.get("tenantId"));
  const canManageToken = authorization.session.role === "SUPER_ADMIN" || authorization.session.role === "ADMIN";
  let connection = await getInstagramConnectionStateFromFile(tenantId);
  if (!connection || !connection.pluginEnabled) {
    connection = await ensureInstagramConnectionDraftFromFile({
      tenantId,
      displayName: authorization.session.displayName || "Agency Instagram",
    });
  }
  return NextResponse.json({ ok: true, tenantId, canManageToken, connection: redactConnection(connection, canManageToken) });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = await request.json().catch(() => ({}));
  const tenantId = resolveSessionTenantId(authorization.session, body?.tenantId);
  const canManageToken = authorization.session.role === "SUPER_ADMIN" || authorization.session.role === "ADMIN";
  if (!canManageToken && text(body?.accessToken)) {
    return NextResponse.json({ ok: false, error: "Only super admin can save an Instagram access token." }, { status: 403 });
  }
  const connection = await updateInstagramConnectionStateFromFile(tenantId, {
    pluginEnabled: typeof body?.pluginEnabled === "boolean" ? body.pluginEnabled : true,
    status: (text(body?.status) || undefined) as DummyInstagramConnectionState["status"] | undefined,
    displayName: body?.displayName,
    username: body?.username,
    instagramBusinessAccountId: body?.instagramBusinessAccountId,
    accessToken: canManageToken ? body?.accessToken : undefined,
    verifyToken: body?.verifyToken,
    graphApiVersion: body?.graphApiVersion,
    note: body?.note,
    lastError: body?.lastError,
  });
  return NextResponse.json({ ok: true, tenantId, canManageToken, connection: redactConnection(connection, canManageToken) });
}
