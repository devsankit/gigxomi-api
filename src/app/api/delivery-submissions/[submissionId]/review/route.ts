import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { reviewDeliverySubmission } from "@/lib/gigxomi/app-assignment-flow-service";

export async function POST(request: Request, context: { params: Promise<{ submissionId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { submissionId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await reviewDeliverySubmission(authorization.session, submissionId, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    assignment: result.assignment,
    revision: result.revision,
    submission: result.submission,
  });
}

export const PATCH = POST;
