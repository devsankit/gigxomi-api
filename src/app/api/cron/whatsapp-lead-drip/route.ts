import { NextResponse } from "next/server";
import { evaluateAndDispatchLeadDrips } from "@/lib/gigxomi/whatsapp-lead-drip-engine";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || "gx_drip_cron_2026";
  
  // Allow if cron secret matches or in internal VPC/localhost
  const isAuthorized =
    authHeader === `Bearer ${cronSecret}` ||
    request.headers.get("x-gigxomi-internal") === "true" ||
    request.headers.get("host")?.includes("localhost") ||
    request.headers.get("host")?.includes("127.0.0.1");

  try {
    const summary = await evaluateAndDispatchLeadDrips();
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      summary,
    });
  } catch (error) {
    console.error("[CRON_WHATSAPP_LEAD_DRIP] Error running drip evaluation:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Drip evaluation failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
