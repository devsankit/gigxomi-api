import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { decideServiceReview } from "@/lib/gigxomi/service-review-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = body?.action === "approve" ? "approve" : body?.action === "reject" ? "reject" : null;

  if (!action) {
    return NextResponse.json({ ok: false, error: "Action must be either approve or reject." }, { status: 400 });
  }

  const result = await decideServiceReview({
    serviceId: id,
    action,
    reviewNote: typeof body?.reviewNote === "string" ? body.reviewNote : typeof body?.note === "string" ? body.note : undefined,
    reviewerId: authorization.session.userId,
    reviewerName: authorization.session.displayName,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    service: result.service,
  });
}