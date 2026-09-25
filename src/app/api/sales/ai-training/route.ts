import { runMemoryTest } from "@/lib/gigxomi/conversation-memory-test";
import { NextResponse } from "next/server";
import {
  AI_SALES_STAGES,
  createAiSalesTrainingDraft,
  getPublishedAiSalesTrainingPrompt,
  listAiSalesTrainingRules,
  setAiSalesTrainingRuleStatus,
  type AiSalesStage,
  type AiSalesTrainingStatus,
} from "@/lib/gigxomi/ai-sales-training-store";
import {
  callGroqAi,
  DEFAULT_GIGXOMI_AI_SALES_PROMPT,
  buildSupportHandoffReply,
  ensureFirstContactGreeting,
  getDeterministicSalesReply,
  isWhatsAppSupportHandoffRequired,
  needsFullSalesContextForAction,
} from "@/lib/gigxomi/whatsapp-flow-engine";

function isAuthorized(request: Request) {
  const key = process.env.AI_TRAINING_API_KEY?.trim();
  return Boolean(key && request.headers.get("authorization") === `Bearer ${key}`);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const status = new URL(request.url).searchParams.get("status") as AiSalesTrainingStatus | null;
  return NextResponse.json({ ok: true, stages: AI_SALES_STAGES, rules: await listAiSalesTrainingRules(status ?? undefined) });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");
  if (action === "memory-test") {
    try { return NextResponse.json(await runMemoryTest(body || {})); }
    catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Memory test failed" }, { status: 400 }); }
  }
  if (action === "test") {
    const messages = Array.isArray(body?.messages)
      ? body.messages
          .map((item) => ({
            role: item && typeof item === "object" && (item as { role?: unknown }).role === "assistant" ? "assistant" as const : "user" as const,
            content: String(item && typeof item === "object" ? (item as { content?: unknown }).content ?? "" : "").trim().slice(0, 1000),
          }))
          .filter((item) => item.content)
          .slice(-40)
      : [];
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return NextResponse.json({ ok: false, error: "Provide up to 40 messages ending with the lead's message." }, { status: 400 });
    }
    const previewStage = String(body?.stage ?? "");
    const previewInstruction = String(body?.instruction ?? "").trim().slice(0, 900);
    const published = await getPublishedAiSalesTrainingPrompt();
    const previewRule = AI_SALES_STAGES.includes(previewStage as AiSalesStage) && previewInstruction
      ? `\n\nPREVIEW DRAFT (do not save this):\n[${previewStage.toUpperCase()}] ${previewInstruction}`
      : "";
    const prompt = `${DEFAULT_GIGXOMI_AI_SALES_PROMPT}${published ? `\n\n${published}` : ""}${previewRule}`;
    const latest = messages[messages.length - 1];
    const isAgencyRegistered = typeof body?.agencyRegistered === "boolean" ? body.agencyRegistered : null;
    if (isWhatsAppSupportHandoffRequired(latest.content, String(body?.mediaContext ?? ""))) {
      return NextResponse.json({
        ok: true,
        reply: ensureFirstContactGreeting(
          buildSupportHandoffReply(latest.content, String(body?.mediaContext ?? "")),
          messages.slice(0, -1),
        ),
        testedMessages: messages.length,
        includesDraft: Boolean(previewRule),
        supportHandoff: true,
        previewOnly: true,
      });
    }
    const deterministicReply = getDeterministicSalesReply(latest.content, messages.slice(0, -1), { isAgencyRegistered });
    if (deterministicReply) {
      return NextResponse.json({
        ok: true,
        reply: ensureFirstContactGreeting(deterministicReply, messages.slice(0, -1)),
        testedMessages: messages.length,
        includesDraft: Boolean(previewRule),
        deterministic: true,
      });
    }
    const reply = await callGroqAi(latest.content, {
      customSystemPrompt: prompt,
      chatHistory: messages.slice(0, -1),
      isAgencyRegistered,
      fullChatContext: needsFullSalesContextForAction(latest.content, messages.slice(0, -1)),
    });
    return NextResponse.json({ ok: true, reply, testedMessages: messages.length, includesDraft: Boolean(previewRule) });
  }
  if (action === "create-draft") {
    const stage = String(body?.stage ?? "") as AiSalesStage;
    const instruction = String(body?.instruction ?? "").trim();
    if (!AI_SALES_STAGES.includes(stage) || !instruction || instruction.length > 900) {
      return NextResponse.json({ ok: false, error: "Provide a valid stage and an instruction under 900 characters." }, { status: 400 });
    }
    const rule = await createAiSalesTrainingDraft({
      stage,
      instruction,
      example: typeof body?.example === "string" ? body.example : undefined,
      sourceConversationId: typeof body?.sourceConversationId === "string" ? body.sourceConversationId : undefined,
    });
    return NextResponse.json({ ok: true, rule }, { status: 201 });
  }
  if (action === "publish" || action === "archive") {
    const rule = await setAiSalesTrainingRuleStatus(String(body?.id ?? ""), action === "publish" ? "published" : "archived");
    return rule ? NextResponse.json({ ok: true, rule }) : NextResponse.json({ ok: false, error: "Rule not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
}
