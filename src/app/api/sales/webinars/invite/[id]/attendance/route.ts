import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { markSalesWebinarAttendance } from "@/lib/gigxomi/sales-operating-system-store";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const { id } = await params;
  const invite = await markSalesWebinarAttendance({
    inviteId: id,
    attended: body?.attended !== false,
    notes: typeof body?.notes === "string" ? body.notes : undefined,
  });
  return NextResponse.json({ ok: true, invite });
}
