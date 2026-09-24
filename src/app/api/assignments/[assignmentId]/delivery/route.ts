import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getAssignmentWorklog, submitAssignmentDelivery } from "@/lib/gigxomi/app-assignment-flow-service";

export async function GET(_: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { assignmentId } = await context.params;
  const result = await getAssignmentWorklog(authorization.session, assignmentId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    assignment: result.assignment,
    submissions: result.submissions,
    revisions: result.revisions,
  });
}

export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { assignmentId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await submitAssignmentDelivery(authorization.session, assignmentId, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    assignment: result.assignment,
    submission: result.submission,
  });
}
