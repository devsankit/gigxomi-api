import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { setAssignmentPerformanceContext } from "@/lib/gigxomi/app-assignment-flow-service";

export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) return authorization.response;
  const { assignmentId } = await context.params;
  const result = await setAssignmentPerformanceContext(authorization.session, assignmentId, await request.json());
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
