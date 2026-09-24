import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  getWhatsAppRuntimeStatus,
  listWhatsAppRuntimeEvents,
  listWhatsAppRuntimeRuns,
} from "@/lib/gigxomi/whatsapp-runtime-store";

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { searchParams } = new URL(request.url);
  const flowRunId = searchParams.get("flowRunId")?.trim() || undefined;
  const limit = Number(searchParams.get("limit") ?? 50);
  const [status, runs, events] = await Promise.all([
    getWhatsAppRuntimeStatus(),
    listWhatsAppRuntimeRuns(Number.isFinite(limit) ? limit : 50),
    listWhatsAppRuntimeEvents({ flowRunId, limit: 100 }),
  ]);

  return NextResponse.json({
    ok: true,
    status,
    runs,
    events,
  });
}
