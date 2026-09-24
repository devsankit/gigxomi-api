import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { saveSalesLesson } from "@/lib/gigxomi/sales-operating-system-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid lesson details." }, { status: 400 });
  try {
    const lesson = await saveSalesLesson({
      id: typeof body.id === "string" ? body.id : undefined,
      courseId: String(body.courseId ?? ""),
      moduleId: typeof body.moduleId === "string" ? body.moduleId : "",
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : "",
      videoUrl: typeof body.videoUrl === "string" ? body.videoUrl : "",
      content: typeof body.content === "string" ? body.content : "",
      estimatedDuration: body.estimatedDuration == null ? null : Number(body.estimatedDuration),
      isRequired: body.isRequired !== false,
      quizRequired: Boolean(body.quizRequired),
      mockCallRequired: Boolean(body.mockCallRequired),
      managerReviewRequired: Boolean(body.managerReviewRequired),
      sortOrder: Number(body.sortOrder ?? 0),
    });
    return NextResponse.json({ ok: true, lesson });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save lesson." }, { status: 400 });
  }
}
