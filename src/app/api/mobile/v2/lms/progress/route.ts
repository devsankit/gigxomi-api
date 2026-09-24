import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { audienceForSession } from "@/lib/connected-platform/audience";
import { LearningAccessError, updateConnectedLmsProgress } from "@/lib/connected-platform/lms";
import { LearningInputError } from "@/lib/connected-platform/learning-validation";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["ADMIN", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const progress = await updateConnectedLmsProgress({
      userId: authorization.session.userId,
      audience: audienceForSession(authorization.session),
      courseId: typeof body?.courseId === "string" ? body.courseId : "",
      chapterId: typeof body?.chapterId === "string" ? body.chapterId : undefined,
      lessonId: typeof body?.lessonId === "string" ? body.lessonId : "",
      playbackSessionId: typeof body?.playbackSessionId === "string" ? body.playbackSessionId : undefined,
      eventId: typeof body?.eventId === "string" ? body.eventId : undefined,
      activeSeconds: body?.activeSeconds === undefined ? undefined : Number(body.activeSeconds),
      playbackState: typeof body?.playbackState === "string" ? body.playbackState : undefined,
      watchedSeconds: Number(body?.watchedSeconds ?? 0),
      durationSeconds: Number(body?.durationSeconds ?? 0),
      positionSeconds: Number(body?.positionSeconds ?? 0),
      confirmComplete: body?.confirmComplete === true,
    });
    return NextResponse.json({ ok: true, progress });
  } catch (error) {
    if (error instanceof LearningAccessError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.code,
          message: error.message,
          availableActions: ["REFRESH_ACCESS", "VIEW_PLANS"],
        },
        { status: error.status },
      );
    }
    if (error instanceof LearningInputError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: "LEARNING_SAVE_UNAVAILABLE", message: "Progress could not be confirmed. Retry the same playback event." }, { status: 503 });
  }
}
