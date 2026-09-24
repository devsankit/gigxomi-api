import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface DynamicTrainerRule {
  id: string;
  rule: string;
  createdAt: string;
  addedBy: string;
}

const RULES_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const RULES_PATH = path.join(RULES_DIRECTORY, "ai-trainer-rules.json");

let rulesCache: DynamicTrainerRule[] | null = null;

export async function getDynamicTrainerRules(): Promise<DynamicTrainerRule[]> {
  if (rulesCache) return rulesCache;
  try {
    const raw = await readFile(RULES_PATH, "utf8");
    rulesCache = JSON.parse(raw) as DynamicTrainerRule[];
    return rulesCache;
  } catch {
    rulesCache = [];
    return rulesCache;
  }
}

export async function addDynamicTrainerRule(ruleText: string, addedBy = "6267605079"): Promise<DynamicTrainerRule> {
  const current = await getDynamicTrainerRules();
  const newRule: DynamicTrainerRule = {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    rule: ruleText.trim(),
    createdAt: new Date().toISOString(),
    addedBy,
  };
  current.push(newRule);
  rulesCache = current;
  try {
    await mkdir(RULES_DIRECTORY, { recursive: true });
    await writeFile(RULES_PATH, JSON.stringify(current, null, 2), "utf8");
  } catch (err) {
    console.error("[AI_TRAINER_STORE] Failed to persist rule:", err);
  }
  return newRule;
}

export async function clearDynamicTrainerRules(): Promise<void> {
  rulesCache = [];
  try {
    await mkdir(RULES_DIRECTORY, { recursive: true });
    await writeFile(RULES_PATH, JSON.stringify([], null, 2), "utf8");
  } catch (err) {
    console.error("[AI_TRAINER_STORE] Failed to clear rules:", err);
  }
}
