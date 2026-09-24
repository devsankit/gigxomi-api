import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getManualUpiAdminConfig, updateManualUpiAdminConfig } from "@/lib/billing/manual-upi-config-service";

type ManualUpiConfigRequest = {
  pluginEnabled?: unknown;
  upiId?: unknown;
  payeeName?: unknown;
  supportWhatsApp?: unknown;
  instructions?: unknown;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const config = await getManualUpiAdminConfig();
  return NextResponse.json({ ok: true, config });
}

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as ManualUpiConfigRequest | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Manual UPI settings are required." }, { status: 400 });
  }

  const config = await updateManualUpiAdminConfig({
    pluginEnabled: body.pluginEnabled === true,
    upiId: readString(body.upiId),
    payeeName: readString(body.payeeName),
    supportWhatsApp: readString(body.supportWhatsApp),
    instructions: readString(body.instructions),
    updatedByUserId: auth.session.userId,
  });

  return NextResponse.json({ ok: true, config });
}
