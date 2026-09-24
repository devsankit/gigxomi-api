import { NextResponse } from "next/server";

import { trackSalesReferralEvent } from "@/lib/gigxomi/sales-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rawCode = body?.code ?? body?.referralCode ?? body?.ref;
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  const channel = typeof body?.channel === "string" ? body.channel.trim() : "website";
  const path = typeof body?.path === "string" ? body.path : "/";

  if (!code) {
    return NextResponse.json({ ok: false, error: "Referral code is required." }, { status: 400 });
  }

  try {
    const result = await trackSalesReferralEvent({
      code,
      eventType: "PRICING_VIEW",
      path,
      metadata: {
        target: channel,
        referrer: request.headers.get("referer") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
      },
    });

    const response = NextResponse.json({ ok: true, result });
    // Set 30-day attribution cookie on response
    response.cookies.set("gx_ref", code, {
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to track referral event." },
      { status: 500 }
    );
  }
}
