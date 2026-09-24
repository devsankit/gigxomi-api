import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesOperatingSnapshot, saveSalesCourse } from "@/lib/gigxomi/sales-operating-system-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const snapshot = await getSalesOperatingSnapshot(authorization.session);
  return NextResponse.json({ ok: true, courses: snapshot.courses, modules: snapshot.modules, lessons: snapshot.lessons, progress: snapshot.progress });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid course details." }, { status: 400 });
  try {
    const course = await saveSalesCourse({
      id: typeof body.id === "string" ? body.id : undefined,
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : "",
      assignedRole: typeof body.assignedRole === "string" ? body.assignedRole : "",
      assignedTeamId: typeof body.assignedTeamId === "string" ? body.assignedTeamId : "",
      isPublished: Boolean(body.isPublished),
      requiredCompletionPercent: Number(body.requiredCompletionPercent ?? 100),
      requiredQuizScore: body.requiredQuizScore == null ? null : Number(body.requiredQuizScore),
      requiresMockCall: Boolean(body.requiresMockCall),
      requiresManagerReview: Boolean(body.requiresManagerReview),
      leadUnlockQuantity: Number(body.leadUnlockQuantity ?? 0),
      sortOrder: Number(body.sortOrder ?? 0),
      createdById: authorization.session.userId,
    });
    return NextResponse.json({ ok: true, course });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save course." }, { status: 400 });
  }
}
