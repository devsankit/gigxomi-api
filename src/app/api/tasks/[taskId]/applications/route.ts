import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { createTaskApplication, listTaskApplications } from "@/lib/gigxomi/app-task-flow-service";

export async function GET(_: Request, context: { params: Promise<{ taskId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { taskId } = await context.params;
  const result = await listTaskApplications(authorization.session, taskId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    task: result.task,
    applications: result.applications,
  });
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { taskId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await createTaskApplication(authorization.session, taskId, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    task: result.task,
    application: result.application,
  });
}
