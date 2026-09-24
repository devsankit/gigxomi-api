import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { claimSalesLeadPoolItem, getSalesSnapshotForRole, syncSalesAgentConversationLinks, updateSalesLeadStage } from "@/lib/gigxomi/sales-store";

const RECORDING_ROOT = path.join(process.cwd(), "data", "uploads", "sales-recordings");
const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const PACK_EXPIRY_MS = 60_000;
const ACTIVE_STAGES = ["NEW", "ASSIGNED", "CONTACTED", "INTERESTED", "WEBINAR_INVITED", "WEBINAR_ATTENDED", "FOLLOW_UP", "NEGOTIATION", "QUALIFIED", "QUOTE_SENT", "PAYMENT_PENDING"] as const;

export type SalesMobileActor = { userId: string; role: "SALES_AGENT" | "SUPER_ADMIN" };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePhone(value: unknown) {
  const digits = clean(value).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function getSalesMobileAgent(actor: SalesMobileActor) {
  const profile = await prisma.salesAgentProfile.findUnique({ where: { userId: actor.userId }, include: { user: true } });
  if (!profile || profile.status !== "ACTIVE") throw new Error("Your sales mobile access is pending or suspended.");
  return profile;
}

export async function registerSalesMobileDevice(actor: SalesMobileActor, input: Record<string, unknown>) {
  const agent = await getSalesMobileAgent(actor);
  const deviceId = clean(input.deviceId);
  if (!deviceId) throw new Error("deviceId is required.");

  const existing = await prisma.salesMobileDevice.findUnique({ where: { deviceId } });
  if (existing && existing.agentId !== agent.id) throw new Error("This company device is registered to another sales agent.");

  return prisma.salesMobileDevice.upsert({
    where: { deviceId },
    create: {
      agentId: agent.id,
      deviceId,
      deviceName: clean(input.deviceName) || "Gigxomi sales phone",
      appVersion: clean(input.appVersion) || null,
      manufacturer: clean(input.manufacturer) || null,
      model: clean(input.model) || null,
      androidVersion: clean(input.androidVersion) || null,
      simLabel: clean(input.simLabel) || null,
      officeSimNumber: clean(input.officeSimNumber) || null,
      recordingCapability: clean(input.recordingCapability) || "UNKNOWN",
      recordingEnabled: input.recordingEnabled === true,
    },
    update: {
      deviceName: clean(input.deviceName) || existing?.deviceName || "Gigxomi sales phone",
      appVersion: clean(input.appVersion) || null,
      manufacturer: clean(input.manufacturer) || null,
      model: clean(input.model) || null,
      androidVersion: clean(input.androidVersion) || null,
      simLabel: clean(input.simLabel) || null,
      officeSimNumber: clean(input.officeSimNumber) || null,
      recordingCapability: clean(input.recordingCapability) || existing?.recordingCapability || "UNKNOWN",
      recordingEnabled: input.recordingEnabled === true,
      isActive: true,
      lastSeenAt: new Date(),
    },
  });
}

export async function heartbeatSalesMobileDevice(actor: SalesMobileActor, deviceId: string, input: Record<string, unknown>) {
  const agent = await getSalesMobileAgent(actor);
  const device = await prisma.salesMobileDevice.findFirst({ where: { deviceId, agentId: agent.id } });
  if (!device || !device.isActive) throw new Error("This device is not active for your account.");
  return prisma.salesMobileDevice.update({
    where: { id: device.id },
    data: {
      lastSeenAt: new Date(),
      appVersion: clean(input.appVersion) || device.appVersion,
      simLabel: clean(input.simLabel) || device.simLabel,
      officeSimNumber: clean(input.officeSimNumber) || device.officeSimNumber,
      recordingCapability: clean(input.recordingCapability) || device.recordingCapability,
    },
  });
}

export async function getSalesMobileBootstrap(actor: SalesMobileActor) {
  const agent = await getSalesMobileAgent(actor);
  // Links are populated lazily for legacy imports and for conversations that
  // arrive after a lead was assigned. This is idempotent and scoped to the
  // current agent, so CRM never broadens its inbox to unassigned threads.
  await syncSalesAgentConversationLinks(agent.id);
  const [snapshot, devices, calls, pendingNotes, pendingUploads] = await Promise.all([
    getSalesSnapshotForRole(actor),
    prisma.salesMobileDevice.findMany({ where: { agentId: agent.id, isActive: true }, orderBy: { lastSeenAt: "desc" } }),
    prisma.salesMobileCall.findMany({ where: { agentId: agent.id }, include: { assignment: true }, orderBy: { startedAt: "desc" }, take: 50 }),
    prisma.salesMobileCall.count({ where: { agentId: agent.id, noteRequired: true, noteSubmitted: false } }),
    prisma.salesMobileCall.count({ where: { agentId: agent.id, recordingStatus: { in: ["LOCAL_PENDING", "UPLOADING", "FAILED"] } } }),
  ]);
  return { agent: snapshot.currentAgent, dashboard: snapshot.reports, leads: snapshot.visibleLeads, settings: snapshot.settings, devices, calls, pendingNotes, pendingUploads };
}

export async function requestSalesMobileLeadPack(actor: SalesMobileActor, sizeInput: unknown) {
  const agent = await getSalesMobileAgent(actor);
  if (!agent.canClaimLeads) throw new Error("Complete the required training before requesting leads.");
  const pendingNotes = await prisma.salesMobileCall.count({ where: { agentId: agent.id, noteRequired: true, noteSubmitted: false } });
  if (pendingNotes) throw new Error("Submit pending call notes before requesting another lead pack.");

  await prisma.salesMobileLeadPack.updateMany({ where: { agentId: agent.id, status: "OFFERED", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
  const existing = await prisma.salesMobileLeadPack.findFirst({ where: { agentId: agent.id, status: "OFFERED", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (existing) return existing;

  const activeCount = await prisma.salesLeadAssignment.count({ where: { assignedAgentId: agent.id, stage: { in: [...ACTIVE_STAGES] } } });
  const maxActive = agent.maxActiveLeads ?? 5;
  if (activeCount >= maxActive) throw new Error(`You already have ${activeCount} active leads.`);
  const requested = Math.max(3, Math.min(5, Number(sizeInput) || 3, maxActive - activeCount));
  const pool = await prisma.salesLeadPoolItem.findMany({
    where: { status: "OPEN", OR: [{ assignedAgentId: null }, { assignedAgentId: agent.id }] },
    orderBy: [{ assignedAgentId: "desc" }, { createdAt: "asc" }],
    take: requested,
  });
  if (!pool.length) throw new Error("No open leads are available right now.");
  return prisma.salesMobileLeadPack.create({ data: { agentId: agent.id, leadPoolIds: pool.map((item) => item.id), expiresAt: new Date(Date.now() + PACK_EXPIRY_MS) } });
}

export async function claimSalesMobileLeadPack(actor: SalesMobileActor, packId: string) {
  const agent = await getSalesMobileAgent(actor);
  const pack = await prisma.salesMobileLeadPack.findFirst({ where: { id: packId, agentId: agent.id } });
  if (!pack || pack.status !== "OFFERED") throw new Error("Lead pack is no longer claimable.");
  if (pack.expiresAt.getTime() <= Date.now()) {
    await prisma.salesMobileLeadPack.update({ where: { id: pack.id }, data: { status: "EXPIRED" } });
    throw new Error("Lead pack expired. Request another pack.");
  }
  const leads = [];
  for (const poolItemId of pack.leadPoolIds) {
    try {
      const result = await claimSalesLeadPoolItem({ poolItemId, agentId: agent.id, actorUserId: actor.userId });
      leads.push(result.lead);
    } catch {
      // A concurrent claim may consume one item; remaining items still belong to this pack.
    }
  }
  if (!leads.length) throw new Error("These leads were claimed by another agent. Request a new pack.");
  await prisma.salesMobileLeadPack.update({ where: { id: pack.id }, data: { status: "CLAIMED", claimedAt: new Date() } });
  return leads;
}

export async function startSalesMobileCall(actor: SalesMobileActor, input: Record<string, unknown>) {
  const agent = await getSalesMobileAgent(actor);
  const pending = await prisma.salesMobileCall.count({ where: { agentId: agent.id, noteRequired: true, noteSubmitted: false } });
  if (pending) throw new Error("Submit the pending call disposition before starting another call.");
  const assignmentId = clean(input.leadId || input.assignmentId);
  const assignment = await prisma.salesLeadAssignment.findFirst({ where: { id: assignmentId, assignedAgentId: agent.id } });
  if (!assignment) throw new Error("This lead is not assigned to you.");
  let device = null;
  if (clean(input.deviceId)) {
    device = await prisma.salesMobileDevice.findFirst({ where: { deviceId: clean(input.deviceId), agentId: agent.id, isActive: true } });
    if (!device) throw new Error("Registered device not found.");
  }
  const call = await prisma.salesMobileCall.create({
    data: {
      assignmentId: assignment.id,
      agentId: agent.id,
      deviceId: device?.id ?? null,
      phoneNumber: clean(input.phoneNumber) || assignment.customerPhone || "",
      direction: clean(input.direction).toUpperCase() === "INBOUND" ? "INBOUND" : "OUTBOUND",
      recordingStatus: clean(input.recordingStatus).toUpperCase() === "RECORDING_UNAVAILABLE" ? "RECORDING_UNAVAILABLE" : "NONE",
    },
  });
  await prisma.salesActivityLog.create({ data: { assignmentId: assignment.id, actorUserId: actor.userId, action: "MOBILE_CALL_STARTED", metadata: { callId: call.id, direction: call.direction } } });
  return call;
}

export async function endSalesMobileCall(actor: SalesMobileActor, input: Record<string, unknown>) {
  const agent = await getSalesMobileAgent(actor);
  const callId = clean(input.callSessionId || input.callId);
  const existing = await prisma.salesMobileCall.findFirst({ where: { id: callId, agentId: agent.id } });
  if (!existing) throw new Error("Call session not found.");
  const statusInput = clean(input.status).toUpperCase();
  const status = (["MISSED", "FAILED", "CONNECTED", "RINGING"] as const).includes(statusInput as never) ? statusInput : "COMPLETED";
  const call = await prisma.salesMobileCall.update({
    where: { id: existing.id },
    data: {
      status: status as "MISSED" | "FAILED" | "CONNECTED" | "RINGING" | "COMPLETED",
      connectedAt: parseDate(input.connectedAt) ?? existing.connectedAt,
      endedAt: parseDate(input.endedAt) ?? new Date(),
      durationSeconds: Number.isFinite(Number(input.durationSeconds)) ? Math.max(0, Number(input.durationSeconds)) : existing.durationSeconds,
      recordingStatus: clean(input.recordingStatus) ? (clean(input.recordingStatus).toUpperCase() as "NONE") : existing.recordingStatus,
      recordingError: clean(input.recordingError) || existing.recordingError,
    },
  });
  await prisma.salesActivityLog.create({ data: { assignmentId: call.assignmentId, actorUserId: actor.userId, action: "MOBILE_CALL_ENDED", metadata: { callId: call.id, status: call.status, durationSeconds: call.durationSeconds } } });
  return call;
}

export async function submitSalesMobileDisposition(actor: SalesMobileActor, input: Record<string, unknown>) {
  const agent = await getSalesMobileAgent(actor);
  const callId = clean(input.callSessionId || input.callId);
  const call = await prisma.salesMobileCall.findFirst({ where: { id: callId, agentId: agent.id }, include: { assignment: true } });
  if (!call) throw new Error("Call session not found.");
  const note = clean(input.note);
  const outcome = clean(input.outcome).toUpperCase();
  if (!note) throw new Error("Call notes are required.");
  if (!outcome) throw new Error("Choose a call outcome.");
  const nextFollowUpAt = parseDate(input.nextFollowUpAt);
  const updated = await prisma.$transaction(async (tx) => {
    const savedCall = await tx.salesMobileCall.update({ where: { id: call.id }, data: { outcome, note, nextFollowUpAt, noteSubmitted: true } });
    await tx.salesLeadAssignment.update({ where: { id: call.assignmentId }, data: { notes: note, followUpAt: nextFollowUpAt, lastContactedAt: call.connectedAt ?? call.endedAt ?? new Date() } });
    await tx.salesActivityLog.create({ data: { assignmentId: call.assignmentId, actorUserId: actor.userId, action: "MOBILE_CALL_DISPOSITION", note, metadata: { callId: call.id, outcome, nextFollowUpAt } } });
    return savedCall;
  });
  const stage = clean(input.stageUpdate).toUpperCase();
  if (stage) await updateSalesLeadStage({ leadId: call.assignmentId, stage: stage as never, note, actorUserId: actor.userId });
  return updated;
}

export async function saveSalesMobileRecording(actor: SalesMobileActor, callId: string, file: File, recordingDurationMs = 0) {
  const agent = await getSalesMobileAgent(actor);
  const call = await prisma.salesMobileCall.findFirst({ where: { id: callId, agentId: agent.id } });
  if (!call) throw new Error("Call session not found.");
  if (!file.size || file.size > MAX_RECORDING_BYTES) throw new Error("Recording must be between 1 byte and 50 MB.");
  const allowed = new Set(["audio/m4a", "audio/mp4", "audio/aac", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/3gpp", "application/octet-stream"]);
  if (!allowed.has(file.type || "application/octet-stream")) throw new Error("Unsupported recording format.");
  await mkdir(RECORDING_ROOT, { recursive: true });
  const extension = safeFileName(path.extname(file.name || "recording.m4a") || ".m4a");
  const fileName = `${safeFileName(call.id)}-${Date.now()}${extension}`;
  const storagePath = path.join(RECORDING_ROOT, fileName);
  await prisma.salesMobileCall.update({ where: { id: call.id }, data: { recordingStatus: "UPLOADING", recordingError: null } });
  try {
    await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));
    const callDurationMs = Math.max(0, (call.durationSeconds ?? 0) * 1000);
    const durationMismatch = callDurationMs >= 10_000 && recordingDurationMs > 0 && recordingDurationMs < callDurationMs * 0.5;
    return await prisma.salesMobileCall.update({
      where: { id: call.id },
      data: {
        recordingStatus: "UPLOADED",
        recordingPath: fileName,
        recordingMimeType: file.type || "application/octet-stream",
        recordingSizeBytes: file.size,
        recordingError: durationMismatch ? `Audio captured ${Math.round(recordingDurationMs / 1000)}s of a ${Math.round(callDurationMs / 1000)}s call. Check device microphone restrictions.` : null,
      },
    });
  } catch (error) {
    await unlink(storagePath).catch(() => undefined);
    await prisma.salesMobileCall.update({ where: { id: call.id }, data: { recordingStatus: "FAILED", recordingError: error instanceof Error ? error.message : "Recording upload failed." } });
    throw error;
  }
}

export async function readSalesMobileRecording(actor: SalesMobileActor, callId: string) {
  const agent = actor.role === "SALES_AGENT" ? await getSalesMobileAgent(actor) : null;
  const call = await prisma.salesMobileCall.findFirst({ where: actor.role === "SUPER_ADMIN" ? { id: callId } : { id: callId, OR: [{ agentId: agent!.id }, { assignment: { assignedAgent: { parentAgentId: agent!.id } } }] } });
  if (!call?.recordingPath) throw new Error("Recording not found.");
  const fileName = safeFileName(path.basename(call.recordingPath));
  return { call, bytes: await readFile(path.join(RECORDING_ROOT, fileName)) };
}

export async function syncSalesMobileContacts(actor: SalesMobileActor, contacts: unknown[]) {
  const agent = await getSalesMobileAgent(actor);
  const leads = await prisma.salesLeadAssignment.findMany({ where: { assignedAgentId: agent.id }, select: { id: true, customerName: true, customerPhone: true, customerEmail: true } });
  const byPhone = new Map<string, (typeof leads)[number]>();
  for (const lead of leads) {
    const phone = normalizePhone(lead.customerPhone);
    if (phone) byPhone.set(phone, lead);
  }
  const matches = contacts.flatMap((value) => {
    const contact = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const phones = Array.isArray(contact.phones) ? contact.phones.map(normalizePhone) : [];
    const lead = phones.map((phone) => byPhone.get(phone)).find(Boolean);
    return lead ? [{ leadId: lead.id, displayName: clean(contact.displayName), matchedPhone: phones.find((phone) => byPhone.has(phone)) }] : [];
  });
  return { matched: matches.length, matches };
}

type OfflineEventInput = { localEventId?: unknown; idempotencyKey?: unknown; type?: unknown; payload?: unknown; deviceId?: unknown };

export async function syncSalesMobileOfflineEvents(actor: SalesMobileActor, values: unknown[]) {
  const agent = await getSalesMobileAgent(actor);
  const results = [];
  for (const value of values) {
    const event = value && typeof value === "object" ? (value as OfflineEventInput) : {};
    const idempotencyKey = clean(event.idempotencyKey || event.localEventId);
    if (!idempotencyKey) {
      results.push({ ok: false, error: "Event idempotency key is required." });
      continue;
    }
    const existing = await prisma.salesMobileOfflineEvent.findUnique({ where: { idempotencyKey } });
    if (existing) {
      results.push({ ok: existing.status === "SYNCED", idempotencyKey, status: existing.status, result: existing.result, error: existing.error });
      continue;
    }
    const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
    let device = null;
    if (clean(event.deviceId)) device = await prisma.salesMobileDevice.findFirst({ where: { deviceId: clean(event.deviceId), agentId: agent.id } });
    const stored = await prisma.salesMobileOfflineEvent.create({ data: { idempotencyKey, agentId: agent.id, deviceId: device?.id ?? null, type: clean(event.type).toUpperCase(), payload: payload as Prisma.InputJsonObject } });
    try {
      let result: unknown;
      if (stored.type === "CALL_END") result = await endSalesMobileCall(actor, payload);
      else if (stored.type === "DISPOSITION") result = await submitSalesMobileDisposition(actor, payload);
      else throw new Error(`Unsupported offline event type: ${stored.type}`);
      await prisma.salesMobileOfflineEvent.update({ where: { id: stored.id }, data: { status: "SYNCED", result: result as Prisma.InputJsonObject, processedAt: new Date() } });
      results.push({ ok: true, idempotencyKey, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Event sync failed.";
      await prisma.salesMobileOfflineEvent.update({ where: { id: stored.id }, data: { status: "FAILED", error: message, retryCount: { increment: 1 } } });
      results.push({ ok: false, idempotencyKey, error: message });
    }
  }
  return results;
}
