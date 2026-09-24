import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { markNotificationRead } from "@/lib/gigxomi/app-notification-service";

async function markRead(_: Request, context: { params: Promise<{ notificationId: string }> }) {
  try {
    const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"]);
    if (!authorization.ok) {
      return authorization.response;
    }

    const { notificationId } = await context.params;
    const result = await markNotificationRead(authorization.session, notificationId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      notification: result.notification,
    });
  } catch (error) {
    console.error("notifications:read failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Notification service is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
}

export const PATCH = markRead;
export const POST = markRead;
