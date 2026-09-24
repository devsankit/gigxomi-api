import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listLeadStatusesFromFile, manageLeadStatusesFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  return NextResponse.json({
    ok: true,
    statuses: await listLeadStatusesFromFile(),
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json();
  const statuses = await manageLeadStatusesFromFile(id, {
    action: body.action,
    statusId: body.statusId,
    label: body.label,
    tone: body.tone,
    active: body.active,
    orderedIds: body.orderedIds,
  });

  return NextResponse.json({
    ok: true,
    statuses,
  });
}
