import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { reviewFreelancerServiceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json();
  const action = body.action === "reject" ? "reject" : "approve";
  const service = await reviewFreelancerServiceFromFile(id, action, body.note);

  if (!service) {
    return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    service,
  });
}
