import "server-only";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface AiUsageRecord {
  at: string;
  purpose?: "memory-summary" | "memory-retrieval";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export interface AiRateLimitSnapshot {
  at: string;
  provider: string;
  model: string;
  keySlot: number;
  httpStatus: number;
  limitRequests: number | null;
  remainingRequests: number | null;
  resetRequests: string | null;
  limitTokens: number | null;
  remainingTokens: number | null;
  resetTokens: string | null;
  error: string | null;
}
const file = path.join(process.cwd(), ".gigxomi", "ai-usage.json");
const rateLimitFile = path.join(process.cwd(), ".gigxomi", "ai-rate-limits.json");

export async function recordAiUsage(record: Omit<AiUsageRecord, "at">) {
  try {
    let records: AiUsageRecord[] = [];
    try { records = JSON.parse(await readFile(file, "utf8")) as AiUsageRecord[]; } catch { /* first record */ }
    records.push({ ...record, at: new Date().toISOString() });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(records.slice(-10000)), "utf8");
  } catch (error) { console.warn("[AI_USAGE] Failed to persist usage", error); }
}

function headerNumber(response: Response, name: string): number | null {
  const value = response.headers.get(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function recordAiRateLimitSnapshot(input: {
  provider: string;
  model: string;
  keySlot: number;
  response: Response;
  error?: string | null;
}) {
  try {
    let snapshots: AiRateLimitSnapshot[] = [];
    try { snapshots = JSON.parse(await readFile(rateLimitFile, "utf8")) as AiRateLimitSnapshot[]; } catch { /* first snapshot */ }
    snapshots.push({
      at: new Date().toISOString(),
      provider: input.provider,
      model: input.model,
      keySlot: input.keySlot,
      httpStatus: input.response.status,
      limitRequests: headerNumber(input.response, "x-ratelimit-limit-requests"),
      remainingRequests: headerNumber(input.response, "x-ratelimit-remaining-requests"),
      resetRequests: input.response.headers.get("x-ratelimit-reset-requests"),
      limitTokens: headerNumber(input.response, "x-ratelimit-limit-tokens"),
      remainingTokens: headerNumber(input.response, "x-ratelimit-remaining-tokens"),
      resetTokens: input.response.headers.get("x-ratelimit-reset-tokens"),
      error: input.error ?? null,
    });
    await mkdir(path.dirname(rateLimitFile), { recursive: true });
    await writeFile(rateLimitFile, JSON.stringify(snapshots.slice(-5000)), "utf8");
  } catch (error) {
    console.warn("[AI_USAGE] Failed to persist Groq rate limits", error);
  }
}

export async function getAiUsageSnapshot() {
  let usage: AiUsageRecord[] = [];
  let rateLimits: AiRateLimitSnapshot[] = [];
  try { usage = JSON.parse(await readFile(file, "utf8")) as AiUsageRecord[]; } catch { /* no usage yet */ }
  try { rateLimits = JSON.parse(await readFile(rateLimitFile, "utf8")) as AiRateLimitSnapshot[]; } catch { /* no snapshots yet */ }
  const latestByKey = new Map<number, AiRateLimitSnapshot>();
  for (const snapshot of rateLimits) latestByKey.set(snapshot.keySlot, snapshot);
  return {
    memoryUsage: ["memory-summary", "memory-retrieval"].map(purpose => {
      const records = usage.filter(item => item.purpose === purpose);
      return { purpose, calls: records.length, inputTokens: records.reduce((n, r) => n + r.inputTokens, 0), outputTokens: records.reduce((n, r) => n + r.outputTokens, 0), totalTokens: records.reduce((n, r) => n + r.totalTokens, 0) };
    }),
    usageCount: usage.length,
    totalTokens: usage.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0),
    latestUsageAt: usage.at(-1)?.at ?? null,
    rateLimits: Array.from(latestByKey.values()).sort((a, b) => a.keySlot - b.keySlot),
  };
}
