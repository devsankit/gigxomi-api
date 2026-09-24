import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";
import { submitSalesMockCall } from "@/lib/gigxomi/sales-operating-system-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SALES_AGENT", "SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send a mock call transcript." }, { status: 400 });
  const sales = await getSalesSnapshotForRole(authorization.session);
  try {
    const attempt = await submitSalesMockCall({
      userId: authorization.session.userId,
      agentId: sales.currentAgent?.id ?? null,
      scenario: String(body.scenario ?? "cold_lead"),
      transcript: String(body.transcript ?? ""),
    });
    return NextResponse.json({ ok: true, attempt });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to submit mock call." }, { status: 400 });
  }
}
