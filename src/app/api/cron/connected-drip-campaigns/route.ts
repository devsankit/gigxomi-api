import { NextResponse } from "next/server";

import { runConnectedDripCampaigns } from "@/lib/connected-platform/drip";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await runConnectedDripCampaigns()) });
}
