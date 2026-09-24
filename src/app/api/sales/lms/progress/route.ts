import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";
import { markSalesLessonComplete } from "@/lib/gigxomi/sales-operating-system-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SALES_AGENT", "SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid progress details." }, { status: 400 });
  const sales = await getSalesSnapshotForRole(authorization.session);
  try {
    const progress = await markSalesLessonComplete({
      userId: authorization.session.userId,
      agentId: sales.currentAgent?.id ?? null,
      courseId: String(body.courseId ?? ""),
      lessonId: String(body.lessonId ?? ""),
    });
    return NextResponse.json({ ok: true, progress });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save progress." }, { status: 400 });
  }
}
