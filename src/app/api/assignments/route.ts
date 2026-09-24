import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { listAssignmentsForActor } from "@/lib/gigxomi/app-assignment-flow-service";

export async function GET() {
  const auth = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!auth.ok) {
    return auth.response;
  }

  const result = await listAssignmentsForActor(auth.session);
  const assignments = (result.assignments ?? []).map((item) => ({
    ...item,
    source: "CHAT" as const,
  }));
  return NextResponse.json({ ok: true, assignments });
}
