import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { reviewPortfolioDraft } from "@/lib/gigxomi/delivery-portfolio-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const approved = body.action === "approve" || body.approved === true;
  const draft = await reviewPortfolioDraft(id, {
    approved,
    reviewedBy: authorization.session.displayName,
    note: typeof body.note === "string" ? body.note : undefined,
  });

  if (!draft) {
    return NextResponse.json({ ok: false, error: "Portfolio draft not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    draft,
  });
}
