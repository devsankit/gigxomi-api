import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { createMobileWorkPost, listMobileWorkMatching } from "@/lib/gigxomi/mobile-work-compat";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const result = await listMobileWorkMatching(authorization.session);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json(result.payload);
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) return authorization.response;
  const body = await request.json().catch(() => ({}));
  const result = await createMobileWorkPost(authorization.session, body);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, workPost: result.workPost });
}
