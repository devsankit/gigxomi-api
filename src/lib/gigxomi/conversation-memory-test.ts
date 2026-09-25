import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { scopeKey, type MemoryMessage } from "./conversation-memory-core";
import { prepareConversationMemory } from "./conversation-memory-store";
import { callGroqAi, generateMemoryText } from "./whatsapp-flow-engine";

// Called only behind the existing AI_TRAINING_API_KEY authentication. Namespace
// is fixed here: caller-provided IDs can never address live memories.
export async function runMemoryTest(body: Record<string, unknown>) {
  const sessionId = String(body.sessionId || randomUUID());
  if (!/^[\w-]{1,100}$/.test(sessionId)) throw new Error("Invalid test session ID");
  const scope = { tenantId: "memory-test", accountId: "memory-test", conversationId: sessionId, namespace: "test" as const };
  const key = scopeKey(scope);
  const rows = await prisma.$queryRaw<Array<{ payload: MemoryMessage }>>`SELECT "payload" FROM "AiConversationMemoryMessage" WHERE "scope" = ${key} ORDER BY "createdAt", "id"`;
  const messages = rows.map(r => r.payload).sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  const supplied = Array.isArray(body.messages) ? body.messages : [];
  if (supplied.length > 500) throw new Error("Maximum 500 test messages per request");
  const turnId = String(body.turnId || randomUUID());
  const priorReply = messages.find(m => m.id === `${turnId}:assistant`);
  if (priorReply) return { ok: true, sessionId, reply: priorReply.content, previewOnly: true, deduplicated: true };
  const offset = Date.now();
  for (let i = 0; i < supplied.length; i++) {
    const m = supplied[i] as Record<string, unknown>;
    if (!m || !["user", "assistant"].includes(String(m.role)) || typeof m.content !== "string" || m.content.length > 20000) throw new Error("Invalid memory test message");
    const id = `${turnId}:${i}`;
    if (!messages.some(x => x.id === id)) messages.push({ id, role: m.role as MemoryMessage["role"], content: m.content, at: new Date(offset + i).toISOString() });
  }
  const latest = messages.at(-1);
  if (!latest || latest.role !== "user") throw new Error("End with a customer message");
  const started = Date.now();
  let summaryCalls = 0, retrievalCalls = 0;
  const prepared = await prepareConversationMemory(scope, messages, latest.content, async (instruction, data, purpose) => {
    if (purpose === "memory-summary") summaryCalls++; else retrievalCalls++;
    return generateMemoryText(instruction, data, purpose);
  });
  const stop = messages.some(m => m.role === "user" && /^(stop|unsubscribe|do not contact|message mat karo)[.!\s]*$/i.test(m.content.trim()));
  const reply = stop ? "" : await callGroqAi(latest.content, {
    preparedMemory: prepared,
    chatHistory: messages.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
    isAgencyRegistered: typeof body.agencyRegistered === "boolean" ? body.agencyRegistered : null,
  });
  const assistant: MemoryMessage = { id: `${turnId}:assistant`, role: "assistant", content: reply, at: new Date(offset + supplied.length + 1).toISOString() };
  await prisma.$executeRaw`INSERT INTO "AiConversationMemoryMessage" ("scope", "id", "sourceId", "payload") VALUES (${key}, ${assistant.id}, ${assistant.id}, ${JSON.stringify(assistant)}::jsonb) ON CONFLICT ("scope", "id") DO NOTHING`;
  return { ok: true, previewOnly: true, sessionId, turnId, reply, proposedAction: stop ? "suppress" : prepared.degraded ? "hold-sensitive-actions" : "reply-only", memoryVersion: prepared.version, retrievedSourceIds: prepared.retrievedSourceIds, degraded: prepared.degraded, usage: { estimatedContextTokensUpperBound: prepared.estimatedTokens, summaryCalls, retrievalCalls }, latencyMs: Date.now() - started };
}
