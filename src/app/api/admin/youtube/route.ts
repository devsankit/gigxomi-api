import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getPlatformYouTubeConnectionView, listPlatformYouTubePublishJobs } from "@/lib/gigxomi/platform-youtube";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const [connection, uploads] = await Promise.all([getPlatformYouTubeConnectionView(), listPlatformYouTubePublishJobs({ limit: 12 })]);

    return NextResponse.json({
      ok: true,
      connection,
      uploads,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load shared YouTube channel state.",
        connection: null,
        uploads: [],
      },
      { status: 503 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Channel secrets are no longer editable here. Use the dedicated super-admin YouTube connect or disconnect actions.",
    },
    { status: 405 },
  );
}
