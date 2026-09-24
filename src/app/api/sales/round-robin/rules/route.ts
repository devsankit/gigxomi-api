import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesOperatingSnapshot, saveSalesRoundRobinRule } from "@/lib/gigxomi/sales-operating-system-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const snapshot = await getSalesOperatingSnapshot(authorization.session);
  return NextResponse.json({ ok: true, rules: snapshot.roundRobinRules });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid rule details." }, { status: 400 });

  try {
    const rule = await saveSalesRoundRobinRule({
      id: typeof body.id === "string" ? body.id : undefined,
      title: String(body.title ?? ""),
      teamId: typeof body.teamId === "string" ? body.teamId : "",
      isActive: body.isActive !== false,
      maxActiveLeads: body.maxActiveLeads == null ? null : Number(body.maxActiveLeads),
      requireTrainingLevel: typeof body.requireTrainingLevel === "string" ? body.requireTrainingLevel : "",
      priorityMode: typeof body.priorityMode === "string" ? body.priorityMode : "balanced",
      batchSize: Number(body.batchSize ?? 1),
    });
    return NextResponse.json({ ok: true, rule });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save round-robin rule." }, { status: 400 });
  }
}
