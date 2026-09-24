import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// A wildcard deployment applies to every agency tenant, including tenants
// created after a flow is published. It never includes the public Gigxomi
// authentication tenant.
export const ALL_AGENCY_TENANTS_DEPLOYMENT_ID = "__all_agency_tenants__";
export const ALL_AGENCY_TENANTS_DEPLOYMENT_NAME = "All agencies (including future agencies)";

export type SuperAdminWhatsAppFlowStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ERROR";
export type SuperAdminWhatsAppPluginStatus = "INTERNAL_ONLY" | "READY_TO_DEPLOY" | "DEPLOYED";
export type SuperAdminAgencyDeploymentStatus = "NOT_DEPLOYED" | "DEPLOYED";

export type SuperAdminWhatsAppFlowNodeKind =
  | "trigger-on-message"
  | "trigger-keyword"
  | "trigger-button-reply"
  | "trigger-list-reply"
  | "message-text"
  | "message-button"
  | "message-list"
  | "message-template"
  | "send-message"
  | "button-message"
  | "condition"
  | "api-request"
  | "ai-text-generation"
  | "keyword-trigger"
  | "intent-lookup"
  | "meta-ai"
  | "assign-manager"
  | "create-lead"
  | "wait"
  | "handoff"
  | "stop";

export type SuperAdminWhatsAppFlowMessageFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
export type SuperAdminWhatsAppTemplateButtonType = "QUICK_REPLY" | "URL";

export type SuperAdminWhatsAppFlowNodeButton = {
  id: string;
  label: string;
  actionType: "QUICK_REPLY" | "URL";
  value: string;
};

export type SuperAdminWhatsAppFlowListRow = {
  id: string;
  title: string;
  description: string;
};

export type SuperAdminWhatsAppFlowListSection = {
  id: string;
  title: string;
  rows: SuperAdminWhatsAppFlowListRow[];
};

export type SuperAdminWhatsAppFlowTemplateComponent = {
  key: string;
  value: string;
};

export type SuperAdminWhatsAppFlowNode = {
  id: string;
  kind: SuperAdminWhatsAppFlowNodeKind;
  title: string;
  body: string;
  position?: { x: number; y: number };
  aiModel?: "META_AI" | "RULE_BASED";
  aiInstruction?: string;
  messageFormat?: SuperAdminWhatsAppFlowMessageFormat;
  mediaUrl?: string;
  documentFileName?: string;
  waitSeconds?: number;
  buttons?: SuperAdminWhatsAppFlowNodeButton[];
  conditionExpression?: string;
  apiUrl?: string;
  apiMethod?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  apiHeaders?: string;
  apiBody?: string;
  outputVariable?: string;
  aiProvider?: "OPENAI" | "GEMINI" | "META_AI" | "RULE_BASED";
  aiModelName?: string;
  aiSystemPrompt?: string;
  aiUserPrompt?: string;
  aiTemperature?: number;
  aiMaxTokens?: number;
  headerText?: string;
  footerText?: string;
  buttonBody?: string;
  listButtonText?: string;
  listSections?: SuperAdminWhatsAppFlowListSection[];
  templateName?: string;
  templateLanguage?: string;
  templateBodyComponents?: SuperAdminWhatsAppFlowTemplateComponent[];
  templateButtons?: Array<{
    id: string;
    type: SuperAdminWhatsAppTemplateButtonType;
    text: string;
    url?: string;
  }>;
};

export type SuperAdminWhatsAppFlowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  branchKey?: string;
};

export type SuperAdminWhatsAppFlowDeployment = {
  tenantId: string;
  agencyName: string;
  status: SuperAdminAgencyDeploymentStatus;
  deployedAt: string | null;
};

export type SuperAdminWhatsAppFlow = {
  id: string;
  name: string;
  summary: string;
  status: SuperAdminWhatsAppFlowStatus;
  triggerMode: "ANY_INCOMING" | "KEYWORD";
  triggerKeyword: string;
  channel: "OFFICIAL_GIGXOMI";
  pluginKey: string;
  pluginVersion: number;
  pluginStatus: SuperAdminWhatsAppPluginStatus;
  testedAt: string | null;
  deployments: SuperAdminWhatsAppFlowDeployment[];
  nodes: SuperAdminWhatsAppFlowNode[];
  edges: SuperAdminWhatsAppFlowEdge[];
  updatedAt: string;
  createdAt: string;
};

export type SuperAdminWhatsAppFlowRun = {
  id: string;
  flowId: string;
  flowName: string;
  status: "SUCCESS" | "WAITING" | "FAILED";
  summary: string;
  createdAt: string;
};

type SuperAdminWhatsAppFlowSnapshot = {
  flows: SuperAdminWhatsAppFlow[];
  runs: SuperAdminWhatsAppFlowRun[];
};

type DbFlowRecord = {
  id: string;
  name: string;
  description: string;
  status: string;
  nodesJson: unknown;
  edgesJson: unknown;
  settingsJson: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

type DbRunRecord = {
  id: string;
  flowId: string;
  status: string;
  contextJson: unknown;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
  flow?: { name: string } | null;
};

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "super-admin-whatsapp-flows.json");
let databaseBootstrapPromise: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function canUseLocalFileFallback() {
  return process.env.NODE_ENV !== "production";
}

function assertStorageConfigured() {
  if (!hasDatabaseUrl() && !canUseLocalFileFallback()) {
    throw new Error("DATABASE_URL is required for production WhatsApp flow storage. File-backed flow storage is disabled in production.");
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `plugin-${randomUUID().slice(0, 8)}`;
}

function toDbStatus(status: SuperAdminWhatsAppFlowStatus) {
  if (status === "ACTIVE") return "active";
  if (status === "PAUSED") return "paused";
  if (status === "ERROR") return "error";
  return "draft";
}

function fromDbStatus(status: string): SuperAdminWhatsAppFlowStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "active") return "ACTIVE";
  if (normalized === "paused") return "PAUSED";
  if (normalized === "error") return "ERROR";
  return "DRAFT";
}

function toDbRunStatus(status: SuperAdminWhatsAppFlowRun["status"]) {
  if (status === "SUCCESS") return "completed";
  if (status === "WAITING") return "waiting";
  return "failed";
}

function fromDbRunStatus(status: string): SuperAdminWhatsAppFlowRun["status"] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "waiting" || normalized === "running") return "WAITING";
  if (normalized === "failed") return "FAILED";
  return "SUCCESS";
}

function normalizeFlowNodeKind(kind: SuperAdminWhatsAppFlowNodeKind) {
  if (kind === "send-message") return "message-text" as const;
  if (kind === "button-message") return "message-button" as const;
  return kind;
}

function buildDefaultFlowNode(kind: SuperAdminWhatsAppFlowNodeKind, title: string, body: string): SuperAdminWhatsAppFlowNode {
  return {
    id: `node-${randomUUID()}`,
    kind,
    title,
    body,
    aiModel: kind === "meta-ai" ? "META_AI" : undefined,
    aiInstruction: kind === "meta-ai" ? "Answer with concise WhatsApp-safe replies and handoff to human on payment or legal questions." : "",
    messageFormat: kind === "send-message" ? "TEXT" : undefined,
    mediaUrl: "",
    documentFileName: "",
    waitSeconds: kind === "wait" ? 60 : 0,
    buttons: [],
    conditionExpression: "",
    apiUrl: "",
    apiMethod: "POST",
    apiHeaders: "",
    apiBody: "",
    outputVariable: "",
    aiProvider: kind === "ai-text-generation" ? "OPENAI" : kind === "meta-ai" ? "META_AI" : undefined,
    aiModelName: "",
    aiSystemPrompt: "",
    aiUserPrompt: "",
    aiTemperature: 0.4,
    aiMaxTokens: 240,
    headerText: "",
    footerText: "",
    buttonBody: "",
    listButtonText: "Choose an option",
    listSections: [],
    templateName: "",
    templateLanguage: "en",
    templateBodyComponents: [],
    templateButtons: [],
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

function buildDefaultSnapshot(): SuperAdminWhatsAppFlowSnapshot {
  const createdAt = nowIso();
  const defaultFlowId = "flow-public-auth-otp";
  const defaultNodes = [
    buildDefaultFlowNode("keyword-trigger", "Listen for Get OTP", "Watch the official Gigxomi WhatsApp line and match the inbound Get OTP command."),
    buildDefaultFlowNode("intent-lookup", "Find matching auth intent", "Look up the latest active public auth intent by normalized sender phone number."),
    {
      ...buildDefaultFlowNode("condition", "Reject mismatched senders", "If the sender has no active intent or uses a different number than the website submission, reply with the registered-number warning."),
      conditionExpression: "auth_intent_status equals matched",
    },
    buildDefaultFlowNode("send-message", "Issue OTP response", "Send the six-digit OTP to the requester in the official Gigxomi WhatsApp thread."),
    {
      ...buildDefaultFlowNode("handoff", "Return user to verify screen", "Keep the website verify page open as the final entry point where the user enters the received code."),
      outputVariable: "public_auth_verify_screen",
    },
    buildDefaultFlowNode("stop", "Stop flow", "Finish once the OTP response has been sent or the mismatch warning has been delivered."),
  ];
  const agencyTriggerNode = buildDefaultFlowNode(
    "trigger-on-message",
    "Welcome Inbound Leads",
    "Start for every new message from ads or organic inbound.",
  );
  const agencyTriageNode = {
    ...buildDefaultFlowNode(
      "message-button",
      "Triage Lead Type",
      "Welcome to Gigxomi 🎬\nVideo Agency Management Software.\n\nTo guide you immediately, which describes you?",
    ),
    buttons: [
      { id: "BTN_AGENCY", label: "Agency / Lead", actionType: "QUICK_REPLY" as const, value: "BTN_AGENCY" },
      { id: "BTN_FREELANCER", label: "Freelance Editor", actionType: "QUICK_REPLY" as const, value: "BTN_FREELANCER" },
    ],
  };
  const agencyReplyNode = buildDefaultFlowNode(
    "message-text",
    "Deliver 7-Day Agency Trial",
    "🚀 *Start Your 7-Day Agency Free Trial:*\n👉 https://app.gigxomi.com/signup?role=agency&source=whatsapp\n\n• Unify WhatsApp & Instagram into one inbox\n• Kanban stage boards for your team\n• Masked Privacy: Editors cannot see or poach your clients\n• ₹2,000/mo after trial\n\nOur onboarding team has been notified. A specialist will assist you shortly if needed!",
  );
  const freelancerReplyNode = buildDefaultFlowNode(
    "message-text",
    "Deliver Play Store Supply Link",
    "👋 *Hey Editor!*\nTop video agencies on Gigxomi recruit and assign client projects exclusively through our mobile app.\n\n📲 *Download the Gigxomi App on Google Play:*\n👉 https://play.google.com/store/apps/details?id=com.gigxomi.app\n\nComplete your profile and link your portfolio reels to receive project briefs!",
  );
  const agencyHandoffNode = {
    ...buildDefaultFlowNode("handoff", "Alert Closer Team", ""),
    outputVariable: "agency_lead_hot",
  };
  const agencyStopNode = buildDefaultFlowNode("stop", "Complete Run", "");

  const agencyChatbotNodes = [
    agencyTriggerNode,
    agencyTriageNode,
    agencyReplyNode,
    freelancerReplyNode,
    agencyHandoffNode,
    agencyStopNode,
  ];

  const agencyChatbotEdges: SuperAdminWhatsAppFlowEdge[] = [
    {
      id: `edge-${agencyTriggerNode.id}-${agencyTriageNode.id}`,
      source: agencyTriggerNode.id,
      target: agencyTriageNode.id,
      branchKey: "default",
      label: "",
    },
    {
      id: `edge-${agencyTriageNode.id}-${agencyReplyNode.id}`,
      source: agencyTriageNode.id,
      target: agencyReplyNode.id,
      branchKey: "button:BTN_AGENCY",
      label: "Agency / Lead",
    },
    {
      id: `edge-${agencyTriageNode.id}-${freelancerReplyNode.id}`,
      source: agencyTriageNode.id,
      target: freelancerReplyNode.id,
      branchKey: "button:BTN_FREELANCER",
      label: "Freelance Editor",
    },
    {
      id: `edge-${agencyReplyNode.id}-${agencyHandoffNode.id}`,
      source: agencyReplyNode.id,
      target: agencyHandoffNode.id,
      branchKey: "default",
      label: "",
    },
    {
      id: `edge-${freelancerReplyNode.id}-${agencyHandoffNode.id}`,
      source: freelancerReplyNode.id,
      target: agencyHandoffNode.id,
      branchKey: "default",
      label: "",
    },
    {
      id: `edge-${agencyHandoffNode.id}-${agencyStopNode.id}`,
      source: agencyHandoffNode.id,
      target: agencyStopNode.id,
      branchKey: "default",
      label: "",
    },
  ];

  return {
    flows: [
      {
        id: defaultFlowId,
        name: "Public OTP handoff",
        summary:
          "Handles website-started login and signup intents on the official Gigxomi line before the flow is copied into agency testing areas later.",
        status: "ACTIVE",
        triggerMode: "KEYWORD",
        triggerKeyword: "Get OTP",
        channel: "OFFICIAL_GIGXOMI",
        pluginKey: "public-otp-handoff",
        pluginVersion: 1,
        pluginStatus: "READY_TO_DEPLOY",
        testedAt: createdAt,
        deployments: [],
        createdAt,
        updatedAt: createdAt,
        nodes: defaultNodes,
        edges: buildLinearEdges(defaultNodes),
      },
      {
        id: "flow-agency-inbox-chatbot",
        name: "Agency inbox chatbot",
        summary: "A shared inbox acknowledgement for every connected agency WhatsApp line. The wildcard deployment automatically covers current and future agencies.",
        status: "ACTIVE",
        triggerMode: "ANY_INCOMING",
        triggerKeyword: "",
        channel: "OFFICIAL_GIGXOMI",
        pluginKey: "agency-inbox-chatbot",
        pluginVersion: 1,
        pluginStatus: "DEPLOYED",
        testedAt: createdAt,
        deployments: [
          {
            tenantId: ALL_AGENCY_TENANTS_DEPLOYMENT_ID,
            agencyName: ALL_AGENCY_TENANTS_DEPLOYMENT_NAME,
            status: "DEPLOYED",
            deployedAt: createdAt,
          },
        ],
        createdAt,
        updatedAt: createdAt,
        nodes: agencyChatbotNodes,
        edges: agencyChatbotEdges,
      },
    ],
    runs: [
      {
        id: `run-${randomUUID()}`,
        flowId: defaultFlowId,
        flowName: "Public OTP handoff",
        status: "SUCCESS",
        summary: "Latest healthy execution pattern for the official Gigxomi OTP command.",
        createdAt,
      },
    ],
  };
}

function normalizeFlow(flow: SuperAdminWhatsAppFlow): SuperAdminWhatsAppFlow {
  const normalizedNodes = Array.isArray(flow.nodes)
    ? flow.nodes.map((node): SuperAdminWhatsAppFlowNode => {
        const normalizedKind = normalizeFlowNodeKind(node.kind);
        const isOtpFlow = flow.id === "flow-public-auth-otp";
        return {
        id: node.id,
        kind: normalizedKind,
        title: node.title,
        body: node.body,
        position:
          node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
            ? { x: Number(node.position.x), y: Number(node.position.y) }
            : undefined,
        aiModel: node.kind === "meta-ai" ? (node.aiModel === "RULE_BASED" ? "RULE_BASED" : "META_AI") : undefined,
        aiInstruction: node.kind === "meta-ai" ? node.aiInstruction ?? "" : "",
        messageFormat: node.messageFormat ?? "TEXT",
        mediaUrl: node.mediaUrl ?? "",
        documentFileName: node.documentFileName ?? "",
        waitSeconds: Number.isFinite(node.waitSeconds) ? Number(node.waitSeconds) : 0,
        conditionExpression:
          normalizedKind === "condition" && isOtpFlow
            ? node.conditionExpression?.trim() || "auth_intent_status equals matched"
            : node.conditionExpression?.trim() ?? "",
        apiUrl: node.apiUrl?.trim() ?? "",
        apiMethod: (node.apiMethod === "GET" || node.apiMethod === "POST" || node.apiMethod === "PUT" || node.apiMethod === "PATCH" || node.apiMethod === "DELETE")
          ? node.apiMethod
          : "POST",
        apiHeaders: node.apiHeaders?.trim() ?? "",
        apiBody: node.apiBody?.trim() ?? "",
        outputVariable:
          normalizedKind === "handoff" && isOtpFlow
            ? node.outputVariable?.trim() || "public_auth_verify_screen"
            : node.outputVariable?.trim() ?? "",
        aiProvider:
          node.aiProvider === "GEMINI" || node.aiProvider === "OPENAI" || node.aiProvider === "META_AI" || node.aiProvider === "RULE_BASED"
            ? node.aiProvider
            : node.kind === "meta-ai"
              ? "META_AI"
              : node.kind === "ai-text-generation"
                ? "OPENAI"
                : undefined,
        aiModelName: node.aiModelName?.trim() ?? "",
        aiSystemPrompt: node.aiSystemPrompt?.trim() ?? "",
        aiUserPrompt: node.aiUserPrompt?.trim() ?? "",
        aiTemperature: Number.isFinite(node.aiTemperature) ? Number(node.aiTemperature) : 0.4,
        aiMaxTokens: Number.isFinite(node.aiMaxTokens) ? Number(node.aiMaxTokens) : 240,
        headerText: node.headerText?.trim() ?? "",
        footerText: node.footerText?.trim() ?? "",
        buttonBody: node.buttonBody?.trim() ?? "",
        listButtonText: node.listButtonText?.trim() || "Choose an option",
        listSections: Array.isArray(node.listSections)
          ? node.listSections
              .map((section) => ({
                id: section.id?.trim() || `section-${randomUUID()}`,
                title: section.title?.trim() || "Section",
                rows: Array.isArray(section.rows)
                  ? section.rows.map((row) => ({
                      id: row.id?.trim() || `row-${randomUUID()}`,
                      title: row.title?.trim() || "Option",
                      description: row.description?.trim() || "",
                    }))
                  : [],
              }))
              .slice(0, 10)
          : [],
        templateName: node.templateName?.trim() ?? "",
        templateLanguage: node.templateLanguage?.trim() || "en",
        templateBodyComponents: Array.isArray(node.templateBodyComponents)
          ? node.templateBodyComponents.map((component) => ({
              key: component.key?.trim() || "",
              value: component.value?.trim() || "",
            }))
          : [],
        templateButtons: Array.isArray(node.templateButtons)
          ? node.templateButtons.map((button) => ({
              id: button.id?.trim() || `template-button-${randomUUID()}`,
              type: button.type === "URL" ? "URL" : "QUICK_REPLY",
              text: button.text?.trim() || "Button",
              url: button.url?.trim() || "",
            }))
          : [],
        buttons: Array.isArray(node.buttons)
          ? node.buttons
              .map((button) => ({
                id: button.id?.trim() || `button-${randomUUID()}`,
                label: button.label?.trim() || "Button",
                actionType: (button.actionType === "URL" ? "URL" : "QUICK_REPLY") as SuperAdminWhatsAppFlowNodeButton["actionType"],
                value: button.value?.trim() || "",
              }))
              .slice(0, 3)
          : [],
        };
      })
    : [];

  return {
    ...flow,
    pluginKey: flow.pluginKey?.trim() || slugify(flow.name),
    pluginVersion: Number.isFinite(flow.pluginVersion) && flow.pluginVersion > 0 ? flow.pluginVersion : 1,
    triggerMode: flow.triggerMode === "ANY_INCOMING" ? "ANY_INCOMING" : "KEYWORD",
    pluginStatus: flow.pluginStatus || "INTERNAL_ONLY",
    testedAt: flow.testedAt || null,
    deployments: Array.isArray(flow.deployments) ? flow.deployments.map((deployment) => ({
      tenantId: deployment.tenantId,
      agencyName: deployment.agencyName,
      status: deployment.status || "NOT_DEPLOYED",
      deployedAt: deployment.deployedAt || null,
    })) : [],
    nodes: normalizedNodes,
    edges: Array.isArray(flow.edges) && flow.edges.length
      ? flow.edges
          .map((edge) => ({
            id: edge.id?.trim() || `edge-${randomUUID()}`,
            source: edge.source,
            target: edge.target,
            label: edge.label?.trim() || "",
            branchKey: edge.branchKey?.trim() || (edge.label?.trim() ? edge.label.trim().toLowerCase() : "default"),
          }))
          .filter((edge) => edge.source && edge.target && normalizedNodes.some((node) => node.id === edge.source) && normalizedNodes.some((node) => node.id === edge.target))
      : buildLinearEdges(normalizedNodes),
  };
}

function flowSettings(flow: SuperAdminWhatsAppFlow) {
  return {
    triggerMode: flow.triggerMode,
    triggerKeyword: flow.triggerKeyword,
    channel: flow.channel,
    pluginKey: flow.pluginKey,
    pluginStatus: flow.pluginStatus,
    testedAt: flow.testedAt,
    deployments: flow.deployments,
  };
}

function flowFromDb(record: DbFlowRecord): SuperAdminWhatsAppFlow {
  const settings = asRecord(record.settingsJson);
  const deployments = Array.isArray(settings.deployments) ? (settings.deployments as SuperAdminWhatsAppFlowDeployment[]) : [];

  return normalizeFlow({
    id: record.id,
    name: record.name,
    summary: record.description,
    status: fromDbStatus(record.status),
    triggerMode: asString(settings.triggerMode, "KEYWORD") === "ANY_INCOMING" ? "ANY_INCOMING" : "KEYWORD",
    triggerKeyword: asString(settings.triggerKeyword, "Get OTP"),
    channel: "OFFICIAL_GIGXOMI",
    pluginKey: asString(settings.pluginKey, slugify(record.name)),
    pluginVersion: Number.isFinite(record.version) && record.version > 0 ? record.version : 1,
    pluginStatus:
      asString(settings.pluginStatus, "INTERNAL_ONLY") === "DEPLOYED"
        ? "DEPLOYED"
        : asString(settings.pluginStatus, "INTERNAL_ONLY") === "READY_TO_DEPLOY"
          ? "READY_TO_DEPLOY"
          : "INTERNAL_ONLY",
    testedAt: asString(settings.testedAt, record.publishedAt?.toISOString() ?? "") || null,
    deployments,
    nodes: Array.isArray(record.nodesJson) ? (record.nodesJson as SuperAdminWhatsAppFlowNode[]) : [],
    edges: Array.isArray(record.edgesJson) ? (record.edgesJson as SuperAdminWhatsAppFlowEdge[]) : [],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function flowRunFromDb(record: DbRunRecord): SuperAdminWhatsAppFlowRun {
  const context = asRecord(record.contextJson);
  const summary = asString(context.summary, record.errorMessage || "WhatsApp flow runtime activity.");
  const flowName = asString(context.flowName, record.flow?.name || record.flowId);
  const createdAt = record.startedAt || record.updatedAt || record.completedAt || record.failedAt || new Date();

  return {
    id: record.id,
    flowId: record.flowId,
    flowName,
    status: fromDbRunStatus(record.status),
    summary,
    createdAt: createdAt.toISOString(),
  };
}

async function readStoreFromFile(): Promise<SuperAdminWhatsAppFlowSnapshot> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SuperAdminWhatsAppFlowSnapshot>;
    return {
      flows: Array.isArray(parsed.flows) ? parsed.flows.map((flow) => normalizeFlow(flow as SuperAdminWhatsAppFlow)) : buildDefaultSnapshot().flows,
      runs: Array.isArray(parsed.runs) ? parsed.runs : buildDefaultSnapshot().runs,
    };
  } catch {
    const snapshot = buildDefaultSnapshot();
    await mkdir(STORE_DIRECTORY, { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
    return snapshot;
  }
}

async function writeStoreToFile(snapshot: SuperAdminWhatsAppFlowSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
}

async function writeStoreToDatabase(snapshot: SuperAdminWhatsAppFlowSnapshot) {
  const flowOperations: Prisma.PrismaPromise<unknown>[] = snapshot.flows.map((flow) => {
    const createdAt = flow.createdAt ? new Date(flow.createdAt) : new Date();
    const updatedAt = flow.updatedAt ? new Date(flow.updatedAt) : new Date();
    const publishedAt = flow.status === "ACTIVE" ? new Date(flow.testedAt || flow.updatedAt || Date.now()) : null;

    return prisma.whatsAppFlow.upsert({
      where: { id: flow.id },
      create: {
        id: flow.id,
        platformScope: "platform",
        tenantId: null,
        agencyId: null,
        name: flow.name,
        description: flow.summary,
        channel: "whatsapp",
        status: toDbStatus(flow.status),
        nodesJson: toJsonValue(flow.nodes),
        edgesJson: toJsonValue(flow.edges),
        settingsJson: toJsonValue(flowSettings(flow)),
        validationJson: toJsonValue({}),
        version: flow.pluginVersion,
        createdAt,
        updatedAt,
        publishedAt,
      },
      update: {
        name: flow.name,
        description: flow.summary,
        channel: "whatsapp",
        status: toDbStatus(flow.status),
        nodesJson: toJsonValue(flow.nodes),
        edgesJson: toJsonValue(flow.edges),
        settingsJson: toJsonValue(flowSettings(flow)),
        version: flow.pluginVersion,
        updatedAt,
        publishedAt,
      },
    });
  });

  const runOperations: Prisma.PrismaPromise<unknown>[] = snapshot.runs.filter((run) => run.id.startsWith("run-")).map((run) =>
    prisma.whatsAppFlowRun.upsert({
      where: { id: run.id },
      create: {
        id: run.id,
        flowId: run.flowId,
        tenantId: "tenant-gigxomi",
        agencyId: null,
        contactId: "system",
        conversationId: null,
        channel: "whatsapp",
        status: toDbRunStatus(run.status),
        currentNodeId: null,
        contextJson: toJsonValue({ summary: run.summary, flowName: run.flowName, source: "builder_activity" }),
        startedAt: new Date(run.createdAt),
        completedAt: run.status === "SUCCESS" ? new Date(run.createdAt) : null,
        failedAt: run.status === "FAILED" ? new Date(run.createdAt) : null,
        errorMessage: run.status === "FAILED" ? run.summary : null,
      },
      update: {
        status: toDbRunStatus(run.status),
        contextJson: toJsonValue({ summary: run.summary, flowName: run.flowName, source: "builder_activity" }),
        updatedAt: new Date(run.createdAt),
        completedAt: run.status === "SUCCESS" ? new Date(run.createdAt) : null,
        failedAt: run.status === "FAILED" ? new Date(run.createdAt) : null,
        errorMessage: run.status === "FAILED" ? run.summary : null,
      },
    }),
  );

  const versionOperations: Prisma.PrismaPromise<unknown>[] = snapshot.flows
    .filter((flow) => flow.status === "ACTIVE")
    .map((flow) =>
      prisma.whatsAppFlowVersion.upsert({
        where: { flowId_version: { flowId: flow.id, version: flow.pluginVersion } },
        create: {
          flowId: flow.id,
          version: flow.pluginVersion,
          snapshotJson: toJsonValue(flow),
          changelog: "Published from Super Admin WhatsApp Flow Builder.",
          publishedBy: "super-admin",
          publishedAt: new Date(flow.testedAt || flow.updatedAt || Date.now()),
        },
        update: {
          snapshotJson: toJsonValue(flow),
          publishedAt: new Date(flow.testedAt || flow.updatedAt || Date.now()),
        },
      }),
    );

  const operations = [...flowOperations, ...runOperations, ...versionOperations];
  if (operations.length) {
    await prisma.$transaction(operations);
  }
}

async function ensureDatabaseSeeded() {
  if (!databaseBootstrapPromise) {
    databaseBootstrapPromise = (async () => {
      const defaults = buildDefaultSnapshot();
      const existing = await prisma.whatsAppFlow.findMany({
        where: { platformScope: "platform", channel: "whatsapp" },
        select: { id: true, nodesJson: true },
      });
      if (!existing.length) {
        await writeStoreToDatabase(defaults);
        return;
      }

      // Existing production installations predate the agency chatbot seed.
      // Add only missing system flows, preserving every customer-created flow
      // and avoiding duplicate historical run records on subsequent starts.
      const existingIds = new Set(existing.map((flow) => flow.id));
      const missingFlows = defaults.flows.filter((flow) => !existingIds.has(flow.id));
      if (missingFlows.length) {
        await writeStoreToDatabase({ flows: missingFlows, runs: [] });
      }

      // Upgrade default agency inbox chatbot if it still has old 1-button nodes
      const agencyDefault = existing.find((flow) => flow.id === "flow-agency-inbox-chatbot");
      if (agencyDefault) {
        const nodes = Array.isArray(agencyDefault.nodesJson) ? (agencyDefault.nodesJson as SuperAdminWhatsAppFlowNode[]) : [];
        const hasTwoButtons = nodes.some(
          (node) =>
            node.kind === "message-button" &&
            node.buttons?.some((button) => button.id === "btn_agency" || button.id === "btn_freelancer"),
        );
        if (!hasTwoButtons) {
          const freshFlow = defaults.flows.find((flow) => flow.id === "flow-agency-inbox-chatbot");
          if (freshFlow) {
            await prisma.whatsAppFlow.update({
              where: { id: "flow-agency-inbox-chatbot" },
              data: {
                nodesJson: toJsonValue(freshFlow.nodes),
                edgesJson: toJsonValue(freshFlow.edges),
                updatedAt: new Date(),
              },
            });
          }
        }
      }
    })();
  }

  return databaseBootstrapPromise;
}

async function readStoreFromDatabase(): Promise<SuperAdminWhatsAppFlowSnapshot> {
  await ensureDatabaseSeeded();
  const [flows, runs] = await Promise.all([
    prisma.whatsAppFlow.findMany({
      where: { platformScope: "platform", channel: "whatsapp" },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.whatsAppFlowRun.findMany({
      orderBy: { updatedAt: "desc" },
      take: 40,
      include: { flow: { select: { name: true } } },
    }),
  ]);

  return {
    flows: (flows as DbFlowRecord[]).map(flowFromDb),
    runs: (runs as DbRunRecord[]).map(flowRunFromDb),
  };
}

async function readStore(): Promise<SuperAdminWhatsAppFlowSnapshot> {
  assertStorageConfigured();
  if (hasDatabaseUrl()) {
    return readStoreFromDatabase();
  }

  return readStoreFromFile();
}

async function writeStore(snapshot: SuperAdminWhatsAppFlowSnapshot) {
  assertStorageConfigured();
  if (hasDatabaseUrl()) {
    await writeStoreToDatabase(snapshot);
    return;
  }

  await writeStoreToFile(snapshot);
}

export async function listSuperAdminWhatsAppFlows() {
  const snapshot = await readStore();
  return snapshot.flows.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listSuperAdminWhatsAppFlowRuns(limit = 12) {
  const snapshot = await readStore();
  return snapshot.runs.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, Math.max(limit, 0));
}

export async function getSuperAdminWhatsAppFlow(flowId: string) {
  const snapshot = await readStore();
  return snapshot.flows.find((flow) => flow.id === flowId) ?? null;
}

export async function saveSuperAdminWhatsAppFlow(
  input: Partial<SuperAdminWhatsAppFlow> & Pick<SuperAdminWhatsAppFlow, "name" | "summary" | "status" | "triggerMode" | "triggerKeyword" | "nodes" | "edges">,
) {
  const snapshot = await readStore();
  const existing = input.id ? snapshot.flows.find((flow) => flow.id === input.id) ?? null : null;
  const timestamp = nowIso();
  const flowId = existing?.id ?? input.id ?? `flow-${randomUUID()}`;

  const nodes = (input.nodes ?? [])
    .map((node): SuperAdminWhatsAppFlowNode => ({
      id: node.id?.trim() || `node-${randomUUID()}`,
      kind: normalizeFlowNodeKind(node.kind),
      title: node.title?.trim() || "Untitled node",
      body: node.body?.trim() || "",
      position:
        node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
          ? { x: Number(node.position.x), y: Number(node.position.y) }
          : undefined,
      aiModel: node.kind === "meta-ai" ? (node.aiModel === "RULE_BASED" ? "RULE_BASED" : "META_AI") : undefined,
      aiInstruction: node.kind === "meta-ai" ? node.aiInstruction?.trim() || "" : "",
      messageFormat: node.messageFormat ?? "TEXT",
      mediaUrl: node.mediaUrl?.trim() || "",
      documentFileName: node.documentFileName?.trim() || "",
      waitSeconds: Number.isFinite(node.waitSeconds) ? Number(node.waitSeconds) : 0,
      conditionExpression: node.conditionExpression?.trim() || "",
      apiUrl: node.apiUrl?.trim() || "",
      apiMethod: node.apiMethod === "GET" || node.apiMethod === "POST" || node.apiMethod === "PUT" || node.apiMethod === "PATCH" || node.apiMethod === "DELETE"
        ? node.apiMethod
        : "POST",
      apiHeaders: node.apiHeaders?.trim() || "",
      apiBody: node.apiBody?.trim() || "",
      outputVariable: node.outputVariable?.trim() || "",
      aiProvider:
        node.aiProvider === "GEMINI" || node.aiProvider === "OPENAI" || node.aiProvider === "META_AI" || node.aiProvider === "RULE_BASED"
          ? node.aiProvider
          : node.kind === "meta-ai"
            ? "META_AI"
            : node.kind === "ai-text-generation"
              ? "OPENAI"
              : undefined,
      aiModelName: node.aiModelName?.trim() || "",
      aiSystemPrompt: node.aiSystemPrompt?.trim() || "",
      aiUserPrompt: node.aiUserPrompt?.trim() || "",
      aiTemperature: Number.isFinite(node.aiTemperature) ? Number(node.aiTemperature) : 0.4,
      aiMaxTokens: Number.isFinite(node.aiMaxTokens) ? Number(node.aiMaxTokens) : 240,
      headerText: node.headerText?.trim() || "",
      footerText: node.footerText?.trim() || "",
      buttonBody: node.buttonBody?.trim() || "",
      listButtonText: node.listButtonText?.trim() || "Choose an option",
      listSections: Array.isArray(node.listSections)
        ? node.listSections.map((section) => ({
            id: section.id?.trim() || `section-${randomUUID()}`,
            title: section.title?.trim() || "Section",
            rows: Array.isArray(section.rows)
              ? section.rows.map((row) => ({
                  id: row.id?.trim() || `row-${randomUUID()}`,
                  title: row.title?.trim() || "Option",
                  description: row.description?.trim() || "",
                }))
              : [],
          }))
        : [],
      templateName: node.templateName?.trim() || "",
      templateLanguage: node.templateLanguage?.trim() || "en",
      templateBodyComponents: Array.isArray(node.templateBodyComponents)
        ? node.templateBodyComponents.map((component) => ({
            key: component.key?.trim() || "",
            value: component.value?.trim() || "",
          }))
        : [],
      templateButtons: Array.isArray(node.templateButtons)
        ? node.templateButtons.map((button) => ({
            id: button.id?.trim() || `template-button-${randomUUID()}`,
            type: button.type === "URL" ? "URL" : "QUICK_REPLY",
            text: button.text?.trim() || "Button",
            url: button.url?.trim() || "",
          }))
        : [],
      buttons: Array.isArray(node.buttons)
        ? node.buttons
            .map((button) => ({
              id: button.id?.trim() || `button-${randomUUID()}`,
              label: button.label?.trim() || "Button",
              actionType: (button.actionType === "URL" ? "URL" : "QUICK_REPLY") as SuperAdminWhatsAppFlowNodeButton["actionType"],
              value: button.value?.trim() || "",
            }))
            .slice(0, 3)
        : [],
    }))
    .filter((node) => Boolean(node.kind));

  const edges = (input.edges ?? [])
    .map((edge) => ({
      id: edge.id?.trim() || `edge-${randomUUID()}`,
      source: edge.source,
      target: edge.target,
      label: edge.label?.trim() || "",
      branchKey: edge.branchKey?.trim() || (edge.label?.trim() ? edge.label.trim().toLowerCase() : "default"),
    }))
    .filter((edge) => edge.source && edge.target && nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target));

  const nextFlow = normalizeFlow({
    id: flowId,
    name: input.name.trim(),
    summary: input.summary.trim(),
    status: input.status,
    triggerMode: input.triggerMode === "ANY_INCOMING" ? "ANY_INCOMING" : "KEYWORD",
    triggerKeyword: input.triggerKeyword.trim() || "Get OTP",
    channel: "OFFICIAL_GIGXOMI",
    pluginKey: input.pluginKey?.trim() || existing?.pluginKey || slugify(input.name),
    pluginVersion:
      input.pluginVersion && input.pluginVersion > 0
        ? input.pluginVersion
        : existing
          ? input.nodes !== existing.nodes || input.summary !== existing.summary || input.name !== existing.name || input.triggerKeyword !== existing.triggerKeyword || input.triggerMode !== existing.triggerMode
            ? existing.pluginVersion + 1
            : existing.pluginVersion
          : 1,
    pluginStatus:
      input.pluginStatus ||
      (input.status === "ACTIVE" ? "READY_TO_DEPLOY" : existing?.pluginStatus) ||
      "INTERNAL_ONLY",
    testedAt: input.status === "ACTIVE" ? timestamp : existing?.testedAt || null,
    deployments: existing?.deployments ?? [],
    nodes,
    edges: edges.length ? edges : buildLinearEdges(nodes),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });

  if (existing) {
    snapshot.flows = snapshot.flows.map((flow) => (flow.id === flowId ? nextFlow : flow));
  } else {
    snapshot.flows = [nextFlow, ...snapshot.flows];
  }

  const nextRun: SuperAdminWhatsAppFlowRun = {
    id: `run-${randomUUID()}`,
    flowId,
    flowName: nextFlow.name,
    status: nextFlow.status === "ACTIVE" ? "SUCCESS" : nextFlow.status === "PAUSED" ? "WAITING" : "FAILED",
    summary:
      nextFlow.status === "ACTIVE"
        ? "Flow saved and ready for super-admin testing on the official Gigxomi line."
        : nextFlow.status === "PAUSED"
          ? "Flow saved in a paused state while super admin reviews the branch logic."
          : "Draft flow saved and waiting for completion before activation.",
    createdAt: timestamp,
  };

  snapshot.runs = [nextRun, ...snapshot.runs].slice(0, 40);

  await writeStore(snapshot);
  return nextFlow;
}

export async function updateSuperAdminWhatsAppFlowMeta(input: {
  flowId: string;
  name?: string;
  summary?: string;
}) {
  const snapshot = await readStore();
  const existing = snapshot.flows.find((flow) => flow.id === input.flowId) ?? null;
  if (!existing) {
    throw new Error("The selected flow no longer exists.");
  }

  const name = input.name?.trim();
  if (input.name !== undefined && !name) {
    throw new Error("Flow name is required.");
  }

  const summary = input.summary?.trim();
  const nextFlow = normalizeFlow({
    ...existing,
    name: name ?? existing.name,
    summary: summary ?? existing.summary,
    pluginKey: name ? slugify(name) : existing.pluginKey,
    updatedAt: nowIso(),
  });

  snapshot.flows = snapshot.flows.map((flow) => (flow.id === existing.id ? nextFlow : flow));
  snapshot.runs = snapshot.runs.map((run) => (run.flowId === existing.id ? { ...run, flowName: nextFlow.name } : run));
  await writeStore(snapshot);
  return nextFlow;
}

export async function deleteSuperAdminWhatsAppFlow(flowId: string) {
  const target = await getSuperAdminWhatsAppFlow(flowId);
  if (!target) {
    throw new Error("The selected flow no longer exists.");
  }

  if (flowId === "flow-public-auth-otp") {
    throw new Error("The public OTP handoff flow is protected and cannot be deleted.");
  }

  if (hasDatabaseUrl()) {
    await prisma.whatsAppFlow.delete({ where: { id: flowId } });
    return target;
  }

  const snapshot = await readStoreFromFile();
  snapshot.flows = snapshot.flows.filter((flow) => flow.id !== flowId);
  snapshot.runs = snapshot.runs.filter((run) => run.flowId !== flowId);
  await writeStoreToFile(snapshot);
  return target;
}

export async function deploySuperAdminWhatsAppFlow(input: {
  flowId: string;
  deployments: Array<{ tenantId: string; agencyName: string }>;
}) {
  const snapshot = await readStore();
  const timestamp = nowIso();
  const targetFlow = snapshot.flows.find((flow) => flow.id === input.flowId) ?? null;

  if (!targetFlow) {
    throw new Error("The selected flow no longer exists.");
  }

  const deploymentMap = new Map(targetFlow.deployments.map((deployment) => [deployment.tenantId, deployment]));
  input.deployments.forEach((deployment) => {
    deploymentMap.set(deployment.tenantId, {
      tenantId: deployment.tenantId,
      agencyName: deployment.agencyName,
      status: "DEPLOYED",
      deployedAt: timestamp,
    });
  });

  const nextFlow = normalizeFlow({
    ...targetFlow,
    pluginStatus: "DEPLOYED",
    deployments: Array.from(deploymentMap.values()).sort((left, right) => left.agencyName.localeCompare(right.agencyName)),
    updatedAt: timestamp,
  });

  snapshot.flows = snapshot.flows.map((flow) => (flow.id === targetFlow.id ? nextFlow : flow));
  const nextRun: SuperAdminWhatsAppFlowRun = {
    id: `run-${randomUUID()}`,
    flowId: nextFlow.id,
    flowName: nextFlow.name,
    status: "SUCCESS",
    summary: `Plugin deployed to ${input.deployments.length} agency workspace${input.deployments.length === 1 ? "" : "s"} from super admin.`,
    createdAt: timestamp,
  };

  snapshot.runs = [nextRun, ...snapshot.runs].slice(0, 40);

  await writeStore(snapshot);
  return nextFlow;
}
