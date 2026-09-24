import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesOperatingSnapshot } from "@/lib/gigxomi/sales-operating-system-store";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const [sales, operating] = await Promise.all([getSalesSnapshotForRole(authorization.session), getSalesOperatingSnapshot(authorization.session)]);
  return NextResponse.json({ ok: true, leads: sales.visibleLeads, timeline: operating.timeline, messages: sales.messages });
}
