import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json();

  return NextResponse.json({
    ok: true,
    media: {
      kind: "gigxomi_youtube",
      uploadStatus: "PENDING",
      privacyStatus: "unlisted",
      channelOwner: "Gigxomi",
      title: body.title ?? "Untitled sample",
      note: "Hook YouTube Data API upload here. Videos should publish to the Gigxomi channel as Unlisted by default.",
    },
  });
}
