import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { saveSalesModule } from "@/lib/gigxomi/sales-operating-system-store";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid module details." }, { status: 400 });
  try {
    const trainingModule = await saveSalesModule({
      id: typeof body.id === "string" ? body.id : undefined,
      courseId: String(body.courseId ?? ""),
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : "",
      sortOrder: Number(body.sortOrder ?? 0),
    });
    return NextResponse.json({ ok: true, module: trainingModule });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save module." }, { status: 400 });
  }
}
