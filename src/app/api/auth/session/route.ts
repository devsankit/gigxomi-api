import { NextResponse } from "next/server";

import { getSessionContext, roleLabel } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionContext();

  const response = NextResponse.json({
    ok: true,
    authenticated: session.role !== "GUEST" && Boolean(session.userId),
    session,
    roleLabel: roleLabel(session.role),
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");

  return response;
}
