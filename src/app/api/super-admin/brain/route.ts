import { NextRequest, NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  exportGigxomiBrainDataset,
  getGigxomiBrainStats,
  recordBrainLearningEntry,
} from "@/lib/gigxomi/gigxomi-brain-engine";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  const wantsExport = url.searchParams.get("export") === "true";

  if (wantsExport) {
    const dataset = await exportGigxomiBrainDataset();
    return new Response(dataset, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `attachment; filename="gigxomi-brain-training-${new Date().toISOString().slice(0, 10)}.jsonl"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const stats = await getGigxomiBrainStats();
  return NextResponse.json({
    ok: true,
    stats,
  });
}

export async function POST(request: NextRequest) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  try {
    const body = await request.json();
    if (!body.conversationId || !body.userPhone || !body.replyText) {
      return NextResponse.json({ ok: false, error: "Missing required fields." }, { status: 400 });
    }

    const entry = await recordBrainLearningEntry({
      conversationId: String(body.conversationId),
      userPhone: String(body.userPhone),
      inboundText: String(body.inboundText || ""),
      inboundMediaContext: body.inboundMediaContext ? String(body.inboundMediaContext) : undefined,
      replyText: String(body.replyText),
      actor: body.actor === "human_closer" ? "human_closer" : "ai",
      persona: body.persona,
      objectionCategory: body.objectionCategory,
      outcome: body.outcome,
      systemPrompt: body.systemPrompt,
    });

    return NextResponse.json({ ok: true, entry });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to record learning entry." },
      { status: 500 },
    );
  }
}
