import fs from "node:fs";
import path from "node:path";

export type BrainPersona =
  | "SOLO_FREELANCER"
  | "VIDEO_EDITOR"
  | "AGENCY_OWNER"
  | "CLIENT"
  | "JOB_SEEKER"
  | "UNKNOWN";

export type BrainObjectionCategory =
  | "PRICING_INQUIRY"
  | "WORKFLOW_MANAGEMENT"
  | "REVISION_CHAOS"
  | "WANTS_PROJECTS"
  | "CLIENT_PRIVACY"
  | "SOFTWARE_WALKTHROUGH"
  | "GENERAL_QUERY";

export type BrainConversionOutcome =
  | "AGENCY_TRIAL_REGISTERED"
  | "TRAINING_CALL_SCHEDULED"
  | "APP_DOWNLOADED"
  | "QUALIFYING"
  | "DROPPED";

export interface BrainDatasetEntry {
  id: string;
  timestamp: string;
  conversationId: string;
  userPhone: string;
  persona: BrainPersona;
  objectionCategory: BrainObjectionCategory;
  mediaContext?: string;
  outcome: BrainConversionOutcome;
  source: "whatsapp" | "closer_chat";
  actor: "ai" | "human_closer";
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}

const BRAIN_DIR = path.join(process.cwd(), "data", "gigxomi-brain");
const BRAIN_FILE = path.join(BRAIN_DIR, "training-conversations.jsonl");

function ensureBrainDir() {
  if (!fs.existsSync(BRAIN_DIR)) {
    fs.mkdirSync(BRAIN_DIR, { recursive: true });
  }
}

/**
 * Automatically classifies user text and attachments into persona and objection category.
 */
export function detectPersonaAndObjection(text: string, mediaContext?: string): {
  persona: BrainPersona;
  objection: BrainObjectionCategory;
} {
  const combined = `${text} ${mediaContext || ""}`.toLowerCase();

  let persona: BrainPersona = "UNKNOWN";
  if (combined.includes("akela") || combined.includes("solo") || combined.includes("freelance") || combined.includes("freelancer")) {
    persona = "SOLO_FREELANCER";
  } else if (combined.includes("agency") || combined.includes("meri team") || combined.includes("5 editor") || combined.includes("10 editor") || combined.includes("clients")) {
    persona = "AGENCY_OWNER";
  } else if (combined.includes("editor") || combined.includes("premiere") || combined.includes("after effects") || combined.includes("davinci") || combined.includes("capcut")) {
    persona = "VIDEO_EDITOR";
  } else if (combined.includes("project chahiye") || combined.includes("kaam chahiye") || combined.includes("job") || combined.includes("hiring")) {
    persona = "JOB_SEEKER";
  }

  let objection: BrainObjectionCategory = "GENERAL_QUERY";
  if (combined.includes("price") || combined.includes("charge") || combined.includes("cost") || combined.includes("kitna") || combined.includes("free") || combined.includes("2000")) {
    objection = "PRICING_INQUIRY";
  } else if (combined.includes("project chahiye") || combined.includes("kaam do") || combined.includes("work chahiye") || combined.includes("orders")) {
    objection = "WANTS_PROJECTS";
  } else if (combined.includes("revision") || combined.includes("changes") || combined.includes("client number") || combined.includes("direct client")) {
    objection = "REVISION_CHAOS";
  } else if (combined.includes("manage") || combined.includes("workflow") || combined.includes("tool") || combined.includes("software") || combined.includes("kanban")) {
    objection = "WORKFLOW_MANAGEMENT";
  } else if (combined.includes("training") || combined.includes("call") || combined.includes("time") || combined.includes("demo") || combined.includes("setup")) {
    objection = "SOFTWARE_WALKTHROUGH";
  }

  return { persona, objection };
}

/**
 * Appends a learning turn to the continuous Gigxomi Brain dataset.
 */
export async function recordBrainLearningEntry(input: {
  conversationId: string;
  userPhone: string;
  inboundText: string;
  inboundMediaContext?: string;
  replyText: string;
  /** Prior turns are retained for review/training analysis; they never control a live reply by themselves. */
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  actor?: "ai" | "human_closer";
  persona?: BrainPersona;
  objectionCategory?: BrainObjectionCategory;
  outcome?: BrainConversionOutcome;
  systemPrompt?: string;
}): Promise<BrainDatasetEntry> {
  ensureBrainDir();

  const { persona: detectedPersona, objection: detectedObjection } = detectPersonaAndObjection(
    input.inboundText,
    input.inboundMediaContext,
  );

  const persona = input.persona || detectedPersona;
  const objectionCategory = input.objectionCategory || detectedObjection;

  let outcome: BrainConversionOutcome = input.outcome || "QUALIFYING";
  if (input.replyText.includes("app.gigxomi.com/signup")) {
    outcome = "AGENCY_TRIAL_REGISTERED";
  } else if (input.replyText.includes("play.google.com/store/apps")) {
    outcome = "APP_DOWNLOADED";
  } else if (input.replyText.includes("training") || input.replyText.includes("call")) {
    outcome = "TRAINING_CALL_SCHEDULED";
  }

  const userContent = [
    input.inboundMediaContext ? input.inboundMediaContext : "",
    input.inboundText.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  const priorTurns = (input.conversationHistory ?? [])
    .filter((message) => message.content.trim())
    .slice(-60)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 1600),
    }));

  const entry: BrainDatasetEntry = {
    id: `brain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    conversationId: input.conversationId,
    userPhone: input.userPhone,
    persona,
    objectionCategory,
    mediaContext: input.inboundMediaContext || undefined,
    outcome,
    source: "whatsapp",
    actor: input.actor || "ai",
    messages: [
      {
        role: "system",
        content: input.systemPrompt || "Gigxomi B2B Consultative Sales Engine. Short, crisp, human Hindi/Hinglish consultation.",
      },
      ...priorTurns,
      {
        role: "user",
        content: userContent,
      },
      {
        role: "assistant",
        content: input.replyText.trim(),
      },
    ],
  };

  try {
    const line = JSON.stringify(entry) + "\n";
    await fs.promises.appendFile(BRAIN_FILE, line, "utf8");
    console.info(`[GIGXOMI_BRAIN] Recorded learning entry ${entry.id} for ${input.userPhone} (Persona: ${persona}, Objection: ${objectionCategory})`);
  } catch (err) {
    console.error("[GIGXOMI_BRAIN] Failed appending learning entry:", err);
  }

  return entry;
}

/**
 * Returns dataset summary analytics for admins and fine-tuning health.
 */
export async function getGigxomiBrainStats() {
  ensureBrainDir();

  if (!fs.existsSync(BRAIN_FILE)) {
    return {
      totalEntries: 0,
      personas: {},
      objections: {},
      outcomes: {},
      recentEntries: [],
    };
  }

  try {
    const content = await fs.promises.readFile(BRAIN_FILE, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    const personas: Record<string, number> = {};
    const objections: Record<string, number> = {};
    const outcomes: Record<string, number> = {};
    const entries: BrainDatasetEntry[] = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as BrainDatasetEntry;
        entries.push(obj);
        personas[obj.persona] = (personas[obj.persona] || 0) + 1;
        objections[obj.objectionCategory] = (objections[obj.objectionCategory] || 0) + 1;
        outcomes[obj.outcome] = (outcomes[obj.outcome] || 0) + 1;
      } catch {
        // skip malformed line
      }
    }

    return {
      totalEntries: entries.length,
      personas,
      objections,
      outcomes,
      recentEntries: entries.slice(-10).reverse(),
    };
  } catch (err) {
    console.error("[GIGXOMI_BRAIN] Failed reading stats:", err);
    return {
      totalEntries: 0,
      personas: {},
      objections: {},
      outcomes: {},
      recentEntries: [],
    };
  }
}

/**
 * Returns the complete dataset formatted for model fine-tuning (e.g. Unsloth / Hugging Face).
 */
export async function exportGigxomiBrainDataset(): Promise<string> {
  ensureBrainDir();
  if (!fs.existsSync(BRAIN_FILE)) return "";
  return fs.promises.readFile(BRAIN_FILE, "utf8");
}
