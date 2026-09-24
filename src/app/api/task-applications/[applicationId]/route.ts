import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { updateTaskApplicationStatus } from "@/lib/gigxomi/app-task-flow-service";

export async function PATCH(request: Request, context: { params: Promise<{ applicationId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { applicationId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await updateTaskApplicationStatus(authorization.session, applicationId, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    application: result.application,
    assignment: result.assignment,
  });
}
