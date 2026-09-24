import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { postAssignmentProgressUpdate } from "@/lib/gigxomi/app-assignment-flow-service";

export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]); if (!auth.ok) return auth.response;
  const { assignmentId } = await context.params; const result = await postAssignmentProgressUpdate(auth.session, assignmentId, await request.json());
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
