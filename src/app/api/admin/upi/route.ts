import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getUpiConfigFromFile, updateUpiConfigFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  return NextResponse.json({
    ok: true,
    config: await getUpiConfigFromFile(),
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json();
  const config = await updateUpiConfigFromFile("tenant-gigxomi", {
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    upiId: body.upiId,
    payeeName: body.payeeName,
    currency: body.currency,
    notePrefix: body.notePrefix,
  });

  return NextResponse.json({
    ok: true,
    config,
  });
}
