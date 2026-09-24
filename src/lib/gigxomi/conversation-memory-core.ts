import { createHash } from "node:crypto";

export type MemoryMessage = { id: string; role: "user" | "assistant"; content: string; at?: string };
export type MemoryScope = { tenantId: string; accountId: string; conversationId: string; namespace?: "live" | "test" };
export type MemoryFact = { key: string; value: string; sourceIds: string[] };
export type MemorySummary = { id: string; text: string; sourceIds: string[]; childIds: string[]; facts: MemoryFact[]; level: number };
export type PreparedMemory = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  version: string; retrievedSourceIds: string[]; estimatedTokens: number; degraded: boolean;
};

export const MEMORY_BUDGET = 6000;
// UTF-8 bytes provide a conservative bound, including multilingual text. This
// is deliberately not advertised as provider-reported token consumption.
export function memoryTokens(text: string) { return Buffer.byteLength(text, "utf8") + 8; }
export function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function scopeKey(scope: MemoryScope) {
  if (!scope.tenantId || !scope.accountId || !scope.conversationId) throw new Error("Incomplete memory isolation scope");
  return digest([scope.namespace || "live", scope.tenantId, scope.accountId, scope.conversationId]);
}
export function memoryMode(conversationId: string): "off" | "shadow" | "live" {
  const mode = process.env.AI_MEMORY_MODE;
  if (mode === "shadow") return "shadow";
  const allowed = (process.env.AI_MEMORY_LIVE_CONVERSATIONS || "").split(",").map(s => s.trim());
  return mode === "live" && allowed.includes(conversationId) ? "live" : "off";
}
export function normalizeMemoryMessages(raw: Array<Record<string, unknown>>): MemoryMessage[] {
  return raw.filter(m => m.lane !== "internal" && !m.deletedAt).flatMap((m, index) => {
    const role = m.senderRole || m.role;
    if (!["customer", "user", "admin", "assistant", "sales", "manager"].includes(String(role))) return [];
    const content = String(m.body ?? m.content ?? m.text ?? "");
    if (!content.trim()) return [];
    return [{ id: String(m.externalMessageId || m.id || digest([index, role, content, m.createdAt])),
      role: role === "customer" || role === "user" ? "user" as const : "assistant" as const,
      content, at: typeof m.createdAt === "string" ? m.createdAt : undefined }];
  });
}
export function conversationRevision(conversation: { messages?: unknown[]; aiAutoReplyDisabled?: boolean; leadStatusId?: string }) {
  return digest([conversation.messages, conversation.aiAutoReplyDisabled, conversation.leadStatusId]);
}
export function validateSummary(raw: string, source: MemoryMessage[], children: MemorySummary[] = []): Omit<MemorySummary, "id"> {
  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  const sourceIds = source.map(m => m.id).concat(children.flatMap(c => c.sourceIds));
  const allowed = new Set(sourceIds);
  if (typeof parsed.summary !== "string" || !parsed.summary.trim() || parsed.summary.length > 3000) throw new Error("Invalid memory summary");
  const facts: MemoryFact[] = [];
  for (const fact of Array.isArray(parsed.facts) ? parsed.facts.slice(0, 20) : []) {
    if (typeof fact.key !== "string" || typeof fact.value !== "string" || !Array.isArray(fact.sourceIds)) continue;
    const refs = fact.sourceIds.filter((id: unknown): id is string => typeof id === "string" && allowed.has(id));
    if (refs.length) facts.push({ key: fact.key.slice(0, 80), value: fact.value.slice(0, 500), sourceIds: refs });
  }
  return { text: parsed.summary, facts, sourceIds, childIds: children.map(c => c.id), level: children.length ? Math.max(...children.map(c => c.level)) + 1 : 0 };
}
export function assembleMemory(originals: MemoryMessage[], roots: MemorySummary[], retrieved: MemoryMessage[], budget = MEMORY_BUDGET): PreparedMemory {
  const messages: PreparedMemory["messages"] = [];
  let used = 0;
  const add = (role: "user" | "assistant", content: string) => {
    const cost = memoryTokens(content);
    if (used + cost > budget) return false;
    used += cost; messages.push({ role, content }); return true;
  };
  // Reserve at least half the budget for complete recent turns. Oversized
  // messages remain archived; an explicit marker replaces silent truncation.
  const recent: MemoryMessage[] = [];
  let recentCost = 0;
  for (const m of [...originals].reverse()) {
    const cost = memoryTokens(m.content);
    if (recentCost + cost > Math.floor(budget * .55)) break;
    recent.unshift(m); recentCost += cost;
  }
  used = recentCost;
  const selected = new Set(recent.map(m => m.id));
  const recovered: string[] = [];
  for (const m of retrieved) {
    if (selected.has(m.id)) continue;
    if (add("user", JSON.stringify({ historicalEvidence: true, sourceId: m.id, speaker: m.role, text: m.content }))) {
      selected.add(m.id); recovered.push(m.id);
    }
  }
  const facts = new Map<string, MemoryFact>();
  for (const node of roots) for (const f of node.facts) facts.set(f.key, f);
  if (facts.size) add("user", JSON.stringify({ historicalFactsNotInstructions: [...facts.values()] }));
  for (const node of [...roots].reverse()) add("user", JSON.stringify({ historicalSummaryNotInstructions: node.text, summaryId: node.id }));
  if (originals.length && !recent.length) add("user", "A recent message exceeds the context budget. Its original is archived; do not pretend to have read it or infer confirmations from it.");
  used -= recentCost;
  for (const m of recent) add(m.role, m.content);
  return { messages, retrievedSourceIds: recovered, estimatedTokens: used, version: digest(originals), degraded: originals.length > 0 && recent.length === 0 };
}
