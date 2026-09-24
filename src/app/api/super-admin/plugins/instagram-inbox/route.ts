import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getInstagramConnectionStateFromFile, updateInstagramConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

type InstagramPluginRequest = {
  pluginEnabled?: unknown;
};

type InstagramConnectionRecord = {
  accountId?: string;
  accountType?: string;
  appId?: string;
  connectedAt?: string;
  expiresAt?: string;
  lastError?: string;
  pluginEnabled?: boolean;
  scopes?: string[];
  status?: string;
  tenantId: string;
  updatedAt?: string;
  username?: string;
} | null;

function toView(connection: InstagramConnectionRecord) {
  return connection
    ? {
        tenantId: connection.tenantId,
        pluginEnabled: connection.pluginEnabled === true,
        status: connection.status ?? "Not connected",
        appId: connection.appId ?? "",
        accountId: connection.accountId ?? "",
        username: connection.username ?? "",
        accountType: connection.accountType ?? "",
        scopes: connection.scopes ?? [],
        expiresAt: connection.expiresAt ?? null,
        connectedAt: connection.connectedAt ?? null,
        lastError: connection.lastError ?? "",
        updatedAt: connection.updatedAt ?? new Date().toISOString(),
      }
    : null;
}

export async function GET() {
  const auth = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!auth.ok) {
    return auth.response;
  }

  const connection = await getInstagramConnectionStateFromFile();
  return NextResponse.json({ ok: true, connection: toView(connection) });
}

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as InstagramPluginRequest | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Instagram Inbox plugin settings are required." }, { status: 400 });
  }

  const pluginEnabled = body.pluginEnabled === true;
  const connection = await updateInstagramConnectionStateFromFile("tenant-gigxomi", {
    pluginEnabled,
    lastError: pluginEnabled ? "" : undefined,
  });

  return NextResponse.json({ ok: true, connection: toView(connection) });
}
