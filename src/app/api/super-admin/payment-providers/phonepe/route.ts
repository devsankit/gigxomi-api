import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getPhonePeAdminConfig, updatePhonePeAdminConfig } from "@/lib/billing/phonepe-admin-config-service";

type PhonePeConfigRequest = {
  pluginEnabled?: unknown;
  oneTimeEnabled?: unknown;
  autopayEnabled?: unknown;
  webhookEnabled?: unknown;
};

function readBoolean(value: unknown) {
  return value === true;
}

export async function GET() {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const config = await getPhonePeAdminConfig();
  return NextResponse.json({ ok: true, config });
}

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as PhonePeConfigRequest | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "PhonePe plugin settings are required." }, { status: 400 });
  }

  const config = await updatePhonePeAdminConfig({
    pluginEnabled: readBoolean(body.pluginEnabled),
    oneTimeEnabled: readBoolean(body.oneTimeEnabled),
    autopayEnabled: readBoolean(body.autopayEnabled),
    webhookEnabled: readBoolean(body.webhookEnabled),
    updatedByUserId: auth.session.userId,
  });

  return NextResponse.json({ ok: true, config });
}
