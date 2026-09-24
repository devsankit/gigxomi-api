import { NextResponse } from "next/server";

import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  listChannelConnectionsFromFile,
  saveChannelConnectionFromFile,
  type ChannelConnection,
  type ChannelConnectionProvider,
} from "@/lib/gigxomi/dummy-platform-file-store";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { searchParams } = new URL(request.url);
  const tenantId = resolveWhatsAppSetupTenantId(authorization.session, searchParams.get("tenantId"));
  const providerFilter = searchParams.get("provider")?.toUpperCase();

  let connections = await listChannelConnectionsFromFile(tenantId);
  if (providerFilter === "WHATSAPP" || providerFilter === "INSTAGRAM") {
    connections = connections.filter((c) => c.provider === providerFilter);
  }

  return NextResponse.json({
    ok: true,
    tenantId,
    connections,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tenantId = resolveWhatsAppSetupTenantId(authorization.session, text(body.tenantId) || undefined);

  const rawProvider = text(body.provider).toUpperCase();
  if (rawProvider !== "WHATSAPP" && rawProvider !== "INSTAGRAM") {
    return NextResponse.json({ ok: false, error: "Provider must be either WHATSAPP or INSTAGRAM" }, { status: 400 });
  }
  const provider = rawProvider as ChannelConnectionProvider;

  const displayName = text(body.displayName) || (provider === "WHATSAPP" ? "WhatsApp Line" : "Instagram Account");
  const phoneNumber = text(body.phoneNumber);
  const phoneNumberId = text(body.phoneNumberId);
  const accountHandle = text(body.accountHandle) || (provider === "WHATSAPP" ? phoneNumber : text(body.username));
  const wabaId = text(body.wabaId);
  const instagramBusinessAccountId = text(body.instagramBusinessAccountId);
  const accessToken = text(body.accessToken);
  const isDefault = Boolean(body.isDefault);

  const newId = `conn-${provider === "WHATSAPP" ? "wa" : "ig"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const connection: ChannelConnection = {
    id: newId,
    tenantId,
    provider,
    displayName,
    accountHandle: accountHandle || undefined,
    phoneNumber: phoneNumber || undefined,
    phoneNumberId: phoneNumberId || undefined,
    wabaId: wabaId || undefined,
    instagramBusinessAccountId: instagramBusinessAccountId || undefined,
    accessToken: accessToken || undefined,
    status: "ACTIVE",
    isDefault,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const saved = await saveChannelConnectionFromFile(connection);
  return NextResponse.json({
    ok: true,
    connection: saved,
  });
}
