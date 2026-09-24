import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { runConnectedDripCampaigns } from "@/lib/connected-platform/drip";

export async function POST() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  try {
    const summary = await runConnectedDripCampaigns();
    return NextResponse.json({
      ok: true,
      summary,
      message: `Drip evaluation finished: ${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed across ${summary.evaluated} candidates.`,
    });
  } catch (error) {
    console.error("[drip-run-api] Error executing drip campaigns:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to run drip campaigns." },
      { status: 500 },
    );
  }
}
