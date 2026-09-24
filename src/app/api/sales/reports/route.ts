import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesOperatingSnapshot } from "@/lib/gigxomi/sales-operating-system-store";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const [sales, operating] = await Promise.all([getSalesSnapshotForRole(authorization.session), getSalesOperatingSnapshot(authorization.session)]);
  return NextResponse.json({
    ok: true,
    reports: sales.reports,
    funnel: sales.reports.funnel,
    leaderboard: sales.reports.leaderboard,
    training: {
      agentLevel: operating.agentLevel,
      completedLessons: operating.progress.filter((item) => item.status === "COMPLETED" && item.lessonId).length,
      pendingMockCalls: operating.mockCalls.filter((item) => item.status === "PENDING_REVIEW").length,
      webinarInvites: operating.webinarInvites.length,
    },
  });
}
