import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { audienceForSession } from "@/lib/connected-platform/audience";
import { listConnectedLmsCatalog } from "@/lib/connected-platform/lms";

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["ADMIN", "FREELANCER", "SALES_AGENT", "SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const audience = audienceForSession(authorization.session);
  const query = new URL(request.url).searchParams.get("q") ?? undefined;
  try {
    const catalog = await listConnectedLmsCatalog({
    audience,
    userId: authorization.session.userId,
    includeDrafts: authorization.session.role === "SUPER_ADMIN",
    query,
  });
    return NextResponse.json({ ok: true, audience, ...catalog });
  } catch {
    return NextResponse.json({ ok: false, error: "LEARNING_UNAVAILABLE", message: "Learning is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
