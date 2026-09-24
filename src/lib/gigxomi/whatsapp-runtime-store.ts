import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type WhatsAppRuntimeRunStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "handed_off"
  | "stopped";

export type WhatsAppRuntimeEventStatus = "success" | "warning" | "failed" | "skipped";

export type WhatsAppRuntimeFlowRun = {
  id: string;
  flowId: string;
  flowName: string;
  tenantId: string;
  agencyId?: string;
  contactId: string;
  conversationId?: string;
  channel: "whatsapp";
  status: WhatsAppRuntimeRunStatus;
  currentNodeId?: string;
  waitingNodeId?: string;
  waitingFor?: "button_reply" | "list_reply" | "delay";
  inboundMessageIds: string[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
  errorMessage?: string;
  contextJson: Record<string, unknown>;
};

export type WhatsAppRuntimeFlowEvent = {
  id: string;
  flowRunId?: string;
  flowId?: string;
  tenantId?: string;
  nodeId?: string;
  eventType:
    | "flow_started"
    | "flow_completed"
    | "flow_failed"
    | "node_executed"
    | "message_sent"
    | "button_clicked"
    | "list_item_selected"
    | "fallback_triggered"
    | "human_handoff"
    | "lead_created"
    | "conversion_goal_reached"
    | "runtime_pending"
    | "webhook_duplicate"
    | "tenant_resolution_failed"
    | "unsupported_node";
  inputJson?: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  status: WhatsAppRuntimeEventStatus;
  errorMessage?: string;
  createdAt: string;
};

type WhatsAppRuntimeSnapshot = {
  runs: WhatsAppRuntimeFlowRun[];
  events: WhatsAppRuntimeFlowEvent[];
  webhookMessages?: string[];
};

type DbRunRecord = {
  id: string;
  flowId: string;
  tenantId: string | null;
  agencyId: string | null;
  contactId: string;
  conversationId: string | null;
  channel: string;
  status: string;
  currentNodeId: string | null;
  waitingNodeId: string | null;
  waitingFor: string | null;
  inboundMessageIds: string[];
  contextJson: unknown;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
  flow?: { name: string } | null;
};

type DbEventRecord = {
  id: string;
  flowRunId: string | null;
  flowId: string | null;
  tenantId: string | null;
  nodeId: string | null;
  eventType: string;
  inputJson: unknown;
  outputJson: unknown;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
};

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "whatsapp-runtime-engine.json");
const MAX_RUNS = 500;
const MAX_EVENTS = 2500;

let queue = Promise.resolve();

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
    throw new Error("DATABASE_URL is required for production WhatsApp runtime storage. File-backed runtime storage is disabled in production.");
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isDuplicateError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

function normalizeRunStatus(status: string): WhatsAppRuntimeRunStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "waiting") return "waiting";
  if (normalized === "completed") return "completed";
  if (normalized === "failed") return "failed";
  if (normalized === "handed_off") return "handed_off";
  if (normalized === "stopped") return "stopped";
  return "running";
}

function normalizeEventStatus(status: string): WhatsAppRuntimeEventStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "warning") return "warning";
  if (normalized === "failed") return "failed";
  if (normalized === "skipped") return "skipped";
  return "success";
}

function runFromDb(record: DbRunRecord): WhatsAppRuntimeFlowRun {
  return {
    id: record.id,
    flowId: record.flowId,
    flowName: record.flow?.name ?? String(asRecord(record.contextJson).flowName ?? record.flowId),
    tenantId: record.tenantId ?? "",
    agencyId: record.agencyId ?? undefined,
    contactId: record.contactId,
    conversationId: record.conversationId ?? undefined,
    channel: "whatsapp",
    status: normalizeRunStatus(record.status),
    currentNodeId: record.currentNodeId ?? undefined,
    waitingNodeId: record.waitingNodeId ?? undefined,
    waitingFor:
      record.waitingFor === "button_reply" || record.waitingFor === "list_reply" || record.waitingFor === "delay"
        ? record.waitingFor
        : undefined,
    inboundMessageIds: Array.isArray(record.inboundMessageIds) ? record.inboundMessageIds : [],
    startedAt: record.startedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString(),
    failedAt: record.failedAt?.toISOString(),
    errorMessage: record.errorMessage ?? undefined,
    contextJson: asRecord(record.contextJson),
  };
}

function eventFromDb(record: DbEventRecord): WhatsAppRuntimeFlowEvent {
  return {
    id: record.id,
    flowRunId: record.flowRunId ?? undefined,
    flowId: record.flowId ?? undefined,
    tenantId: record.tenantId ?? undefined,
    nodeId: record.nodeId ?? undefined,
    eventType: record.eventType as WhatsAppRuntimeFlowEvent["eventType"],
    inputJson: record.inputJson ? asRecord(record.inputJson) : undefined,
    outputJson: record.outputJson ? asRecord(record.outputJson) : undefined,
    status: normalizeEventStatus(record.status),
    errorMessage: record.errorMessage ?? undefined,
    createdAt: record.createdAt.toISOString(),
  };
}

async function readSnapshotFromFile(): Promise<WhatsAppRuntimeSnapshot> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<WhatsAppRuntimeSnapshot>;
    return {
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      webhookMessages: Array.isArray(parsed.webhookMessages) ? parsed.webhookMessages : [],
    };
  } catch {
    return { runs: [], events: [], webhookMessages: [] };
  }
}

async function writeSnapshotToFile(snapshot: WhatsAppRuntimeSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(
    STORE_PATH,
    JSON.stringify(
      {
        runs: snapshot.runs.slice(0, MAX_RUNS),
        events: snapshot.events.slice(0, MAX_EVENTS),
        webhookMessages: (snapshot.webhookMessages ?? []).slice(0, MAX_EVENTS),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function withRuntimeSnapshot<T>(action: (snapshot: WhatsAppRuntimeSnapshot) => Promise<T> | T) {
  const run = async () => {
    const snapshot = await readSnapshotFromFile();
    const result = await action(snapshot);
    await writeSnapshotToFile(snapshot);
    return result;
  };

  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function listWhatsAppRuntimeRuns(limit = 50) {
  assertStorageConfigured();
  if (hasDatabaseUrl()) {
    const runs = await prisma.whatsAppFlowRun.findMany({
      orderBy: { updatedAt: "desc" },
      take: Math.max(limit, 0),
      include: { flow: { select: { name: true } } },
    });
    return (runs as DbRunRecord[]).map(runFromDb);
  }

  const snapshot = await readSnapshotFromFile();
  return snapshot.runs
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(limit, 0));
}

export async function listWhatsAppRuntimeEvents(input?: { flowRunId?: string; limit?: number }) {
  assertStorageConfigured();
  const limit = Math.max(input?.limit ?? 100, 0);
  if (hasDatabaseUrl()) {
    const events = await prisma.whatsAppFlowEvent.findMany({
      where: input?.flowRunId ? { flowRunId: input.flowRunId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return (events as DbEventRecord[]).map(eventFromDb);
  }

  const snapshot = await readSnapshotFromFile();
  return snapshot.events
    .filter((event) => !input?.flowRunId || event.flowRunId === input.flowRunId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export async function getWhatsAppRuntimeStatus() {
  const runs = await listWhatsAppRuntimeRuns(MAX_RUNS);
  const running = runs.filter((run) => run.status === "running").length;
  const waiting = runs.filter((run) => run.status === "waiting").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const handedOff = runs.filter((run) => run.status === "handed_off").length;
  return {
    totalRuns: runs.length,
    running,
    waiting,
    failed,
    handedOff,
    latestRun: runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null,
  };
}

export async function hasProcessedInboundMessage(messageId: string) {
  const normalized = messageId.trim();
  if (!normalized) return false;
  assertStorageConfigured();
  if (hasDatabaseUrl()) {
    const existing = await prisma.whatsAppWebhookMessageEvent.findUnique({
      where: { provider_messageId: { provider: "whatsapp_cloud_api", messageId: normalized } },
    });
    return Boolean(existing);
  }

  const snapshot = await readSnapshotFromFile();
  return Boolean(snapshot.webhookMessages?.includes(normalized) || snapshot.runs.some((run) => run.inboundMessageIds.includes(normalized)));
}

export async function claimWhatsAppWebhookMessage(input: {
  messageId: string;
  phoneNumberId?: string;
  tenantId?: string;
  agencyId?: string;
  payloadJson?: Record<string, unknown>;
}) {
  const normalized = input.messageId.trim();
  if (!normalized) return true;
  assertStorageConfigured();

  if (hasDatabaseUrl()) {
    try {
      const existing = await prisma.whatsAppWebhookMessageEvent.findUnique({
        where: { provider_messageId: { provider: "whatsapp_cloud_api", messageId: normalized } },
        select: { id: true, processedAt: true },
      });
      if (existing) {
        if (existing.processedAt) {
          // Message already completely processed in a previous webhook run. Reject duplicate!
          return false;
        }
        // Message was just recorded by routeAndRecordWhatsAppWebhook in this request; permit processing!
        return true;
      }

      await prisma.whatsAppWebhookMessageEvent.create({
        data: {
          provider: "whatsapp_cloud_api",
          messageId: normalized,
          phoneNumberId: input.phoneNumberId ?? null,
          tenantId: input.tenantId ?? null,
          agencyId: input.agencyId ?? null,
          payloadJson: toJsonValue(input.payloadJson ?? {}),
        },
      });
      return true;
    } catch (error) {
      if (isDuplicateError(error)) return false;
      throw error;
    }
  }

  return withRuntimeSnapshot((snapshot) => {
    const messages = new Set(snapshot.webhookMessages ?? []);
    if (messages.has(normalized)) return false;
    messages.add(normalized);
    snapshot.webhookMessages = Array.from(messages).slice(-MAX_EVENTS);
    return true;
  });
}

export async function markWhatsAppWebhookMessageProcessed(messageId: string) {
  const normalized = messageId.trim();
  if (!normalized) return;
  assertStorageConfigured();
  if (hasDatabaseUrl()) {
    await prisma.whatsAppWebhookMessageEvent.updateMany({
      where: { provider: "whatsapp_cloud_api", messageId: normalized },
      data: { processedAt: new Date() },
    });
  }
}

export async function findWaitingWhatsAppRun(input: {
  tenantId: string;
  contactId: string;
  channel?: "whatsapp";
}) {
  assertStorageConfigured();
  if (hasDatabaseUrl()) {
    const run = await prisma.whatsAppFlowRun.findFirst({
      where: {
        tenantId: input.tenantId,
        contactId: input.contactId,
        channel: input.channel ?? "whatsapp",
        status: "waiting",
      },
      orderBy: { updatedAt: "desc" },
      include: { flow: { select: { name: true } } },
    });
    return run ? runFromDb(run as DbRunRecord) : null;
  }

  const snapshot = await readSnapshotFromFile();
  return (
    snapshot.runs
      .filter((run) => run.tenantId === input.tenantId)
      .filter((run) => run.contactId === input.contactId)
      .filter((run) => run.channel === (input.channel ?? "whatsapp"))
      .filter((run) => run.status === "waiting")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}

export async function createWhatsAppRuntimeRun(input: {
  flowId: string;
  flowName: string;
  tenantId: string;
  contactId: string;
  conversationId?: string;
  inboundMessageId: string;
  currentNodeId?: string;
  contextJson?: Record<string, unknown>;
}) {
  assertStorageConfigured();
  const timestamp = nowIso();
  const run: WhatsAppRuntimeFlowRun = {
    id: `flow-run-${randomUUID()}`,
    flowId: input.flowId,
    flowName: input.flowName,
    tenantId: input.tenantId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    channel: "whatsapp",
    status: "running",
    currentNodeId: input.currentNodeId,
    inboundMessageIds: input.inboundMessageId ? [input.inboundMessageId] : [],
    startedAt: timestamp,
    updatedAt: timestamp,
    contextJson: input.contextJson ?? {},
  };

  if (hasDatabaseUrl()) {
    const created = await prisma.whatsAppFlowRun.create({
      data: {
        id: run.id,
        flowId: input.flowId,
        tenantId: input.tenantId,
        agencyId: null,
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        channel: "whatsapp",
        status: "running",
        currentNodeId: input.currentNodeId ?? null,
        inboundMessageIds: run.inboundMessageIds,
        contextJson: toJsonValue({ ...run.contextJson, flowName: input.flowName }),
        startedAt: new Date(timestamp),
      },
      include: { flow: { select: { name: true } } },
    });
    return runFromDb(created as DbRunRecord);
  }

  return withRuntimeSnapshot((snapshot) => {
    snapshot.runs = [run, ...snapshot.runs].slice(0, MAX_RUNS);
    return run;
  });
}

export async function attachInboundMessageToWhatsAppRun(runId: string, inboundMessageId: string) {
  const normalized = inboundMessageId.trim();
  assertStorageConfigured();
  if (hasDatabaseUrl()) {
    const existing = await prisma.whatsAppFlowRun.findUnique({ where: { id: runId }, include: { flow: { select: { name: true } } } });
    if (!existing) return null;
    const inboundMessageIds = normalized && !existing.inboundMessageIds.includes(normalized) ? [...existing.inboundMessageIds, normalized] : existing.inboundMessageIds;
    const updated = await prisma.whatsAppFlowRun.update({
      where: { id: runId },
      data: { inboundMessageIds, updatedAt: new Date() },
      include: { flow: { select: { name: true } } },
    });
    return runFromDb(updated as DbRunRecord);
  }

  return withRuntimeSnapshot((snapshot) => {
    const run = snapshot.runs.find((item) => item.id === runId) ?? null;
    if (!run) return null;
    run.updatedAt = nowIso();
    if (normalized && !run.inboundMessageIds.includes(normalized)) {
      run.inboundMessageIds = [...run.inboundMessageIds, normalized];
    }
    return run;
  });
}

export async function updateWhatsAppRuntimeRun(
  runId: string,
  patch: Partial<Omit<WhatsAppRuntimeFlowRun, "id" | "startedAt" | "inboundMessageIds">>,
) {
  assertStorageConfigured();
  if (hasDatabaseUrl()) {
    const timestamp = new Date();
    const data: Prisma.WhatsAppFlowRunUpdateInput = {
      status: patch.status,
      currentNodeId: patch.currentNodeId,
      waitingNodeId: patch.waitingNodeId,
      waitingFor: patch.waitingFor,
      contextJson: patch.contextJson ? toJsonValue(patch.contextJson) : undefined,
      errorMessage: patch.errorMessage,
      updatedAt: timestamp,
    };

    if (patch.status === "completed" || patch.status === "stopped" || patch.status === "handed_off") {
      data.completedAt = patch.completedAt ? new Date(patch.completedAt) : timestamp;
    }
    if (patch.status === "failed") {
      data.failedAt = patch.failedAt ? new Date(patch.failedAt) : timestamp;
    }

    const updated = await prisma.whatsAppFlowRun.update({
      where: { id: runId },
      data,
      include: { flow: { select: { name: true } } },
    });
    return runFromDb(updated as DbRunRecord);
  }

  return withRuntimeSnapshot((snapshot) => {
    const index = snapshot.runs.findIndex((run) => run.id === runId);
    if (index === -1) return null;
    const timestamp = nowIso();
    const next: WhatsAppRuntimeFlowRun = {
      ...snapshot.runs[index],
      ...patch,
      updatedAt: timestamp,
      completedAt:
        patch.status === "completed" || patch.status === "stopped" || patch.status === "handed_off"
          ? patch.completedAt ?? timestamp
          : patch.completedAt ?? snapshot.runs[index].completedAt,
      failedAt: patch.status === "failed" ? patch.failedAt ?? timestamp : patch.failedAt ?? snapshot.runs[index].failedAt,
    };
    snapshot.runs[index] = next;
    return next;
  });
}

export async function appendWhatsAppRuntimeEvent(input: {
  flowRunId?: string;
  flowId?: string;
  tenantId?: string;
  nodeId?: string;
  eventType: WhatsAppRuntimeFlowEvent["eventType"];
  inputJson?: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  status?: WhatsAppRuntimeEventStatus;
  errorMessage?: string;
}) {
  assertStorageConfigured();
  if (hasDatabaseUrl()) {
    const event = await prisma.whatsAppFlowEvent.create({
      data: {
        flowRunId: input.flowRunId ?? null,
        flowId: input.flowId ?? null,
        tenantId: input.tenantId ?? null,
        nodeId: input.nodeId ?? null,
        eventType: input.eventType,
        inputJson: input.inputJson ? toJsonValue(input.inputJson) : undefined,
        outputJson: input.outputJson ? toJsonValue(input.outputJson) : undefined,
        status: input.status ?? "success",
        errorMessage: input.errorMessage,
      },
    });
    return eventFromDb(event as DbEventRecord);
  }

  return withRuntimeSnapshot((snapshot) => {
    const event: WhatsAppRuntimeFlowEvent = {
      id: `flow-event-${randomUUID()}`,
      flowRunId: input.flowRunId,
      flowId: input.flowId,
      tenantId: input.tenantId,
      nodeId: input.nodeId,
      eventType: input.eventType,
      inputJson: input.inputJson,
      outputJson: input.outputJson,
      status: input.status ?? "success",
      errorMessage: input.errorMessage,
      createdAt: nowIso(),
    };
    snapshot.events = [event, ...snapshot.events].slice(0, MAX_EVENTS);
    return event;
  });
}
