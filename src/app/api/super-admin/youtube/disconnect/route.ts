import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { disconnectPlatformYouTubeConnection } from "@/lib/gigxomi/platform-youtube";

export async function POST() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const connection = await disconnectPlatformYouTubeConnection();
  return NextResponse.json({
    ok: true,
    connection,
  });
}
