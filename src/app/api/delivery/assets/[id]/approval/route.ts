import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { recordDeliveryApproval } from "@/lib/gigxomi/delivery-portfolio-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json();
  const { id } = await context.params;
  const outcome = await recordDeliveryApproval(id, {
    approved: Boolean(body.approved),
    reviewedBy: authorization.session.displayName,
    note: typeof body.note === "string" ? body.note : undefined,
  });

  if (!outcome) {
    return NextResponse.json({ ok: false, error: "Delivery asset not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    ...outcome,
  });
}
