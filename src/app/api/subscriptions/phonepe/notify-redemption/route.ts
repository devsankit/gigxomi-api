import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { notifyRedemption } from "@/lib/billing/recurring-billing-service";

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { subscriptionId?: string } | null;
  const subscriptionId = body?.subscriptionId?.trim();
  if (!subscriptionId) {
    return NextResponse.json({ ok: false, error: "Subscription id is required." }, { status: 400 });
  }

  const result = await notifyRedemption(subscriptionId);
  return NextResponse.json({ ok: true, result });
}
