import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { inviteMobileEditor } from "@/lib/gigxomi/mobile-work-compat";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) return authorization.response;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await inviteMobileEditor(authorization.session, id, body);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, invite: result.invite });
}
