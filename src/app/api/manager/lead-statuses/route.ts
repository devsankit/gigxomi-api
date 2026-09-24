import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  listLeadStatusesFromFile,
  manageLeadStatusesFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const statuses = await listLeadStatusesFromFile();
  return NextResponse.json({
    ok: true,
    statuses,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json();
  const statuses = await manageLeadStatusesFromFile("", {
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
