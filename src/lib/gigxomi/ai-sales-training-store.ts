import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const AI_SALES_STAGES = ["intro", "profile", "problem", "impact", "solution", "close"] as const;
export type AiSalesStage = (typeof AI_SALES_STAGES)[number];
export type AiSalesTrainingStatus = "draft" | "published" | "archived";

export interface AiSalesTrainingRule {
  id: string;
  stage: AiSalesStage;
  instruction: string;
  example?: string;
  sourceConversationId?: string;
  status: AiSalesTrainingStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

interface AiSalesTrainingProfile {
  version: number;
  updatedAt: string;
  rules: AiSalesTrainingRule[];
}

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "ai-sales-training-profile.json");
let profileCache: AiSalesTrainingProfile | null = null;

function emptyProfile(): AiSalesTrainingProfile {
  return { version: 1, updatedAt: new Date().toISOString(), rules: [] };
}

async function getProfile() {
  if (profileCache) return profileCache;
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, "utf8")) as AiSalesTrainingProfile;
    profileCache = { ...emptyProfile(), ...parsed, rules: Array.isArray(parsed.rules) ? parsed.rules : [] };
  } catch {
    profileCache = emptyProfile();
  }
  return profileCache;
}

async function saveProfile(profile: AiSalesTrainingProfile) {
  profile.updatedAt = new Date().toISOString();
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(profile, null, 2), "utf8");
  profileCache = profile;
  return profile;
}

export async function listAiSalesTrainingRules(status?: AiSalesTrainingStatus) {
  const profile = await getProfile();
  return profile.rules.filter((rule) => !status || rule.status === status);
}

export async function createAiSalesTrainingDraft(input: {
  stage: AiSalesStage;
  instruction: string;
  example?: string;
  sourceConversationId?: string;
}) {
  const profile = await getProfile();
  const now = new Date().toISOString();
  const rule: AiSalesTrainingRule = {
    id: `sales-rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    stage: input.stage,
    instruction: input.instruction.trim(),
    example: input.example?.trim() || undefined,
    sourceConversationId: input.sourceConversationId?.trim() || undefined,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  profile.rules.push(rule);
  await saveProfile(profile);
  return rule;
}

export async function setAiSalesTrainingRuleStatus(id: string, status: AiSalesTrainingStatus) {
  const profile = await getProfile();
  const rule = profile.rules.find((candidate) => candidate.id === id);
  if (!rule) return null;
  rule.status = status;
  rule.updatedAt = new Date().toISOString();
  rule.publishedAt = status === "published" ? rule.updatedAt : undefined;
  await saveProfile(profile);
  return rule;
}

export async function getPublishedAiSalesTrainingPrompt() {
  const rules = await listAiSalesTrainingRules("published");
  if (!rules.length) return "";
  return [
    "APPROVED STAGE TRAINING (follow only when relevant; core product truth always wins):",
    ...rules.map((rule) => `[${rule.stage.toUpperCase()}] ${rule.instruction}${rule.example ? ` Example: ${rule.example}` : ""}`),
  ].join("\n");
}
