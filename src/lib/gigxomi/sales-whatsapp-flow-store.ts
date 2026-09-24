import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import type {
  SuperAdminWhatsAppFlow,
  SuperAdminWhatsAppFlowEdge,
  SuperAdminWhatsAppFlowNode,
  SuperAdminWhatsAppFlowNodeButton,
  SuperAdminWhatsAppFlowRun,
} from "@/lib/gigxomi/super-admin-whatsapp-flow-store";

type SalesWhatsAppFlowSnapshot = {
  flows: SuperAdminWhatsAppFlow[];
  runs: SuperAdminWhatsAppFlowRun[];
};

type SalesWhatsAppFlowInput = Partial<SuperAdminWhatsAppFlow> &
  Pick<SuperAdminWhatsAppFlow, "name" | "summary" | "status" | "triggerMode" | "triggerKeyword" | "nodes" | "edges">;

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi", "sales-whatsapp-flows");

function nowIso() {
  return new Date().toISOString();
}

function safeScopeKey(scopeId: string) {
  return (
    scopeId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown-sales-account"
  );
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `plugin-${randomUUID().slice(0, 8)}`
  );
}

function storePathForScope(scopeId: string) {
  return path.join(STORE_DIRECTORY, `${safeScopeKey(scopeId)}.json`);
}

function emptySnapshot(): SalesWhatsAppFlowSnapshot {
  return { flows: [], runs: [] };
}

function normalizeButton(button: Partial<SuperAdminWhatsAppFlowNodeButton>, index: number): SuperAdminWhatsAppFlowNodeButton {
  const fallback = `option_${index + 1}`;
  const value = button.value?.trim() || button.id?.trim() || fallback;
  return {
    id: button.id?.trim() || value,
    label: button.label?.trim() || `Option ${index + 1}`,
    actionType: button.actionType === "URL" ? "URL" : "QUICK_REPLY",
    value,
  };
}

function normalizeNode(node: SuperAdminWhatsAppFlowNode): SuperAdminWhatsAppFlowNode {
  return {
    ...node,
    id: node.id?.trim() || `node-${randomUUID()}`,
    title: node.title?.trim() || "Untitled node",
    body: node.body?.trim() || "",
    messageFormat: node.messageFormat ?? "TEXT",
    mediaUrl: node.mediaUrl?.trim() || "",
    documentFileName: node.documentFileName?.trim() || "",
    waitSeconds: Number.isFinite(node.waitSeconds) ? Number(node.waitSeconds) : 0,
    conditionExpression: node.conditionExpression?.trim() || "",
    apiUrl: node.apiUrl?.trim() || "",
    apiMethod:
      node.apiMethod === "GET" || node.apiMethod === "POST" || node.apiMethod === "PUT" || node.apiMethod === "PATCH" || node.apiMethod === "DELETE"
        ? node.apiMethod
        : "POST",
    apiHeaders: node.apiHeaders?.trim() || "",
    apiBody: node.apiBody?.trim() || "",
    outputVariable: node.outputVariable?.trim() || "",
    aiModelName: node.aiModelName?.trim() || "",
    aiSystemPrompt: node.aiSystemPrompt?.trim() || "",
    aiUserPrompt: node.aiUserPrompt?.trim() || "",
    aiTemperature: Number.isFinite(node.aiTemperature) ? Number(node.aiTemperature) : 0.4,
    aiMaxTokens: Number.isFinite(node.aiMaxTokens) ? Number(node.aiMaxTokens) : 240,
    buttons: Array.isArray(node.buttons) ? node.buttons.map(normalizeButton).slice(0, 3) : [],
  };
}

function buildLinearEdges(nodes: SuperAdminWhatsAppFlowNode[]): SuperAdminWhatsAppFlowEdge[] {
  return nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${node.id}-${nodes[index + 1]?.id}`,
    source: node.id,
    target: nodes[index + 1]?.id ?? node.id,
    label: "",
    branchKey: "default",
  }));
}

function normalizeEdges(edges: SuperAdminWhatsAppFlowEdge[], nodes: SuperAdminWhatsAppFlowNode[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return edges
    .map((edge) => ({
      id: edge.id?.trim() || `edge-${randomUUID()}`,
      source: edge.source,
      target: edge.target,
      label: edge.label?.trim() || "",
      branchKey: edge.branchKey?.trim() || "default",
    }))
    .filter((edge) => edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

function normalizeFlow(flow: SuperAdminWhatsAppFlow): SuperAdminWhatsAppFlow {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes.map(normalizeNode).filter((node) => Boolean(node.kind)) : [];
  const edges = Array.isArray(flow.edges) ? normalizeEdges(flow.edges, nodes) : [];
  return {
    ...flow,
    id: flow.id?.trim() || `flow-${randomUUID()}`,
    name: flow.name?.trim() || "New WhatsApp flow",
    summary: flow.summary?.trim() || "Private sales chatbot flow.",
    status: flow.status === "ACTIVE" || flow.status === "PAUSED" ? flow.status : "DRAFT",
    triggerMode: flow.triggerMode === "ANY_INCOMING" ? "ANY_INCOMING" : "KEYWORD",
    triggerKeyword: flow.triggerKeyword?.trim() || "Get OTP",
    channel: "OFFICIAL_GIGXOMI",
    pluginKey: flow.pluginKey?.trim() || slugify(flow.name || "sales-flow"),
    pluginVersion: Number.isFinite(flow.pluginVersion) && flow.pluginVersion > 0 ? flow.pluginVersion : 1,
    pluginStatus: flow.pluginStatus || (flow.status === "ACTIVE" ? "READY_TO_DEPLOY" : "INTERNAL_ONLY"),
    testedAt: flow.testedAt || null,
    deployments: [],
    nodes,
    edges: edges.length ? edges : buildLinearEdges(nodes),
    createdAt: flow.createdAt || nowIso(),
    updatedAt: flow.updatedAt || nowIso(),
  };
}

async function readStore(scopeId: string): Promise<SalesWhatsAppFlowSnapshot> {
  try {
    const raw = await readFile(storePathForScope(scopeId), "utf8");
    const parsed = JSON.parse(raw) as Partial<SalesWhatsAppFlowSnapshot>;
    return {
      flows: Array.isArray(parsed.flows) ? parsed.flows.map((flow) => normalizeFlow(flow as SuperAdminWhatsAppFlow)) : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch {
    return emptySnapshot();
  }
}

async function writeStore(scopeId: string, snapshot: SalesWhatsAppFlowSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(storePathForScope(scopeId), JSON.stringify(snapshot, null, 2), "utf8");
}

export async function listSalesWhatsAppFlows(scopeId: string) {
  const snapshot = await readStore(scopeId);
  return snapshot.flows.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listSalesWhatsAppFlowRuns(scopeId: string, limit = 12) {
  const snapshot = await readStore(scopeId);
  return snapshot.runs.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, Math.max(limit, 0));
}

export async function saveSalesWhatsAppFlow(scopeId: string, input: SalesWhatsAppFlowInput) {
  const snapshot = await readStore(scopeId);
  const existing = input.id ? snapshot.flows.find((flow) => flow.id === input.id) ?? null : null;
  const timestamp = nowIso();
  const flow = normalizeFlow({
    ...input,
    id: existing?.id ?? input.id ?? `flow-${randomUUID()}`,
    channel: "OFFICIAL_GIGXOMI",
    pluginKey: input.pluginKey || existing?.pluginKey || slugify(input.name),
    pluginVersion: existing ? existing.pluginVersion + 1 : 1,
    pluginStatus: input.pluginStatus || (input.status === "ACTIVE" ? "READY_TO_DEPLOY" : existing?.pluginStatus) || "INTERNAL_ONLY",
    testedAt: input.status === "ACTIVE" ? timestamp : existing?.testedAt || null,
    deployments: [],
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });

  snapshot.flows = existing ? snapshot.flows.map((item) => (item.id === flow.id ? flow : item)) : [flow, ...snapshot.flows];
  const runStatus: SuperAdminWhatsAppFlowRun["status"] = flow.status === "ACTIVE" ? "SUCCESS" : flow.status === "PAUSED" ? "WAITING" : "FAILED";

  snapshot.runs = [
    {
      id: `run-${randomUUID()}`,
      flowId: flow.id,
      flowName: flow.name,
      status: runStatus,
      summary: "Private sales chatbot flow saved for this account only.",
      createdAt: timestamp,
    },
    ...snapshot.runs,
  ].slice(0, 40);

  await writeStore(scopeId, snapshot);
  return flow;
}

export async function updateSalesWhatsAppFlowMeta(scopeId: string, input: { flowId: string; name?: string; summary?: string }) {
  const snapshot = await readStore(scopeId);
  const timestamp = nowIso();
  const existing = snapshot.flows.find((flow) => flow.id === input.flowId) ?? null;
  if (!existing) {
    throw new Error("The selected private sales flow no longer exists.");
  }

  const flow = normalizeFlow({
    ...existing,
    name: input.name?.trim() || existing.name,
    summary: input.summary?.trim() || existing.summary,
    updatedAt: timestamp,
  });
  snapshot.flows = snapshot.flows.map((item) => (item.id === flow.id ? flow : item));
  await writeStore(scopeId, snapshot);
  return flow;
}

export async function deleteSalesWhatsAppFlow(scopeId: string, flowId: string) {
  const snapshot = await readStore(scopeId);
  const existing = snapshot.flows.find((flow) => flow.id === flowId) ?? null;
  if (!existing) {
    throw new Error("The selected private sales flow no longer exists.");
  }

  snapshot.flows = snapshot.flows.filter((flow) => flow.id !== flowId);
  snapshot.runs = snapshot.runs.filter((run) => run.flowId !== flowId);
  await writeStore(scopeId, snapshot);
  return existing;
}

export async function listAllActiveSalesWhatsAppFlows(): Promise<SuperAdminWhatsAppFlow[]> {
  try {
    const entries = await readdir(STORE_DIRECTORY).catch(() => [] as string[]);
    const jsonFiles = entries.filter((file) => file.endsWith(".json"));
    const allFlows: SuperAdminWhatsAppFlow[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = await readFile(path.join(STORE_DIRECTORY, file), "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.flows)) {
          for (const flow of parsed.flows) {
            if (flow && (flow.status === "ACTIVE" || flow.status === "DRAFT")) {
              allFlows.push(normalizeFlow(flow));
            }
          }
        }
      } catch {
        // ignore unreadable file
      }
    }
    return allFlows;
  } catch {
    return [];
  }
}
