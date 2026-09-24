import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { reviewSalesMockCall } from "@/lib/gigxomi/sales-operating-system-store";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid review details." }, { status: 400 });
  const attempt = await reviewSalesMockCall({
    id,
    reviewerId: authorization.session.userId,
    status: String(body.status ?? "APPROVED"),
    managerScore: body.managerScore == null ? null : Number(body.managerScore),
    feedback: typeof body.feedback === "string" ? body.feedback : "",
  });
  return NextResponse.json({ ok: true, attempt });
}
