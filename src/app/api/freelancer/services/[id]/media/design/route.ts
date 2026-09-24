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
      kind: "drive_original",
      uploadStatus: "PENDING",
      title: body.title ?? "Untitled design asset",
      note: "Use Drive-backed original storage here, then create Gigxomi-controlled preview and thumbnail URLs for search delivery.",
    },
  });
}
