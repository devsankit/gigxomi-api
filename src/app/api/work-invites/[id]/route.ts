import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { respondToMobileWorkInvite } from "@/lib/gigxomi/mobile-work-compat";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await respondToMobileWorkInvite(authorization.session, id, body);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, invite: result.invite });
}
