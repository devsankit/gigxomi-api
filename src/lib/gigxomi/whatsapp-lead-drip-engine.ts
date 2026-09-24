import "server-only";
import { prisma } from "@/lib/prisma";
import { getLeadAgencyRegistrationStateByPhone } from "./auto-lead-qualifier";
import { digest } from "./conversation-memory-core";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  listConversationsForAudienceFromFile,
  getConversationByIdFromFile,
  deliverConversationMessageFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";

/**
 * Follow-ups deliberately have only two purposes. They are not a generic
 * sales sequence: a message is sent only when the customer has already taken
 * a concrete action and is waiting on the next one.
 */
export type DripAudienceCategory =
  | "REGISTRATION_LINK_PENDING"
  | "REGISTERED_TRAINING_PENDING"
  | "NONE";

export interface ConversationDripState {
  conversationId: string;
  customerPhone: string;
  customerName: string;
  audienceCategory: DripAudienceCategory;
  currentStage: number; // 0 = no follow-up, 1 = one permitted reminder sent
  lastDripSentAt?: string;
  nextScheduledAt?: string;
  paused: boolean;
  pauseReason?: "customer_opt_out" | "manual";
  pausedAt?: string;
  completed: boolean;
  history: Array<{
    stage: number;
    sentAt: string;
    body: string;
    purpose?: "registration-link" | "training-time";
  }>;
}

type ConversationMessage = {
  role?: string;
  senderRole?: string;
  body?: string;
  text?: string;
  createdAt?: string;
};

type FollowUpDecision = {
  category: DripAudienceCategory;
  delayHours: number;
  purpose?: "registration-link" | "training-time";
};

const DRIP_STORE_DIR = path.join(process.cwd(), ".gigxomi");
const DRIP_STORE_FILE = path.join(DRIP_STORE_DIR, "whatsapp-lead-drips.json");

// A regular WhatsApp reply is permitted only inside the customer-initiated
// window. Do not create an unauthorised free-form follow-up outside it.
const MAX_CUSTOMER_WINDOW_HOURS = 23;
const LINK_REMINDER_DELAY_HOURS = 20;
const TRAINING_REMINDER_DELAY_HOURS = 12;

let memoryDripCache: Record<string, ConversationDripState> | null = null;
let activeDripEvaluation: Promise<{
  evaluated: number;
  dispatched: number;
  skipped: number;
  outsideHours: boolean;
}> | null = null;

async function loadDripStore(): Promise<Record<string, ConversationDripState>> {
  if (memoryDripCache) return memoryDripCache;
  try {
    const raw = await readFile(DRIP_STORE_FILE, "utf8");
    memoryDripCache = JSON.parse(raw) as Record<string, ConversationDripState>;
    return memoryDripCache;
  } catch {
    memoryDripCache = {};
    return memoryDripCache;
  }
}

async function saveDripStore(data: Record<string, ConversationDripState>): Promise<void> {
  memoryDripCache = data;
  try {
    await mkdir(DRIP_STORE_DIR, { recursive: true });
    await writeFile(DRIP_STORE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[WHATSAPP_LEAD_DRIP] Failed to save drip store:", err);
  }
}

/** Checks if current time is inside IST business hours (10 AM to 7 PM). */
export function isInsideIstWorkingHours(): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const currentTime = formatter.format(new Date());
    return currentTime >= "10:00" && currentTime < "19:00";
  } catch {
    return false;
  }
}

function isCustomerMessage(message: ConversationMessage) {
  return message.role === "customer" || message.senderRole === "customer" || message.role === "user";
}

function isAssistantMessage(message: ConversationMessage) {
  return message.role === "admin" || message.senderRole === "admin" || message.role === "assistant";
}

function messageBody(message: ConversationMessage) {
  return String(message.body ?? message.text ?? "").trim();
}

/**
 * A STOP or a natural language opt-out ends automation completely. This must
 * stay intentionally broad: silence is kinder than trying to recover a lead
 * who has said no.
 */
export function hasConversationOptOut(messages: ConversationMessage[]) {
  return messages.some((message) => {
    if (!isCustomerMessage(message)) return false;
    return /(?:^|\b)(?:stop|unsubscribe|do\s+not\s+contact|don't\s+contact|dont\s+contact|not\s+interested|no\s+thanks|i\s+(?:don't|dont|do\s+not)\s+wanna?\s+(?:do|continue)|i\s+(?:don't|dont|do\s+not)\s+want|nahi\s+chahiye|interested\s+nahi|baat\s+nahi\s+karni|message\s+mat|mat\s+message|band\s+karo|contact\s+mat)(?:\b|$)/i.test(messageBody(message));
  });
}

function hasRegisteredAgencyStatus(statusId: string) {
  return ["agency-registered", "agency-connected"].includes(String(statusId || "").trim());
}

function isAgencyRegistrationLink(text: string) {
  return /https:\/\/app\.gigxomi\.com\/signup\?role=agency(?:&[^\s]*)?/i.test(text);
}

function asksForTrainingTime(text: string) {
  return /(?:setup|training|onboarding).{0,80}(?:time|available|10\s*(?:am|a\.m\.)|7\s*(?:pm|p\.m\.))|(?:time|available).{0,80}(?:setup|training|onboarding)/i.test(text);
}

function isEnglishLead(messages: ConversationMessage[]) {
  const mostRecentCustomerText = [...messages].reverse().find(isCustomerMessage);
  const text = messageBody(mostRecentCustomerText || {});
  return /\b(?:i|we|you|the|and|from|your|how|what|can|please|yes|no|interested|registration)\b/i.test(text) &&
    !/\b(?:aap|ap|hai|hain|kaise|karna|karte|mujhe|mera|meri|nahi|haan|ji)\b/i.test(text);
}

/**
 * Derives follow-up eligibility from the actual conversation state. It never
 * guesses intent from job/editor/agency keywords, and returns only one of the
 * two explicitly permitted business reminders.
 */
export function getContextAwareFollowUpDecision(input: {
  messages: ConversationMessage[];
  leadStatusId?: string;
}): FollowUpDecision | null {
  const messages = input.messages || [];
  const latest = messages[messages.length - 1];
  if (!latest || !isAssistantMessage(latest) || hasConversationOptOut(messages)) return null;

  const latestText = messageBody(latest);
  if (!latestText) return null;

  if (!hasRegisteredAgencyStatus(input.leadStatusId || "") && isAgencyRegistrationLink(latestText)) {
    return {
      category: "REGISTRATION_LINK_PENDING",
      delayHours: LINK_REMINDER_DELAY_HOURS,
      purpose: "registration-link",
    };
  }

  if (hasRegisteredAgencyStatus(input.leadStatusId || "") && asksForTrainingTime(latestText)) {
    return {
      category: "REGISTERED_TRAINING_PENDING",
      delayHours: TRAINING_REMINDER_DELAY_HOURS,
      purpose: "training-time",
    };
  }

  return null;
}

/** Kept for the CRM drip endpoint; it now describes only real action state. */
export function classifyLeadDripContext(messagesText: string, notes?: string): DripAudienceCategory {
  const combined = `${messagesText} ${notes || ""}`;
  if (isAgencyRegistrationLink(combined)) return "REGISTRATION_LINK_PENDING";
  if (asksForTrainingTime(combined)) return "REGISTERED_TRAINING_PENDING";
  return "NONE";
}

/** Legacy export for callers; each allowed category has exactly one message. */
export const DRIP_CADENCE_HOURS: Record<number, number> = { 1: LINK_REMINDER_DELAY_HOURS };

export function getDripMessageContent(
  category: DripAudienceCategory,
  stage: number,
  firstName: string,
  english = false,
): string | null {
  if (stage !== 1) return null;
  const name = firstName.trim();
  const salutation = name ? `Hi ${name}` : "Hi";

  if (category === "REGISTRATION_LINK_PENDING") {
    return english
      ? `${salutation}, just checking in in case you still want to try Gigxomi. If you need the agency registration link again, reply here and I’ll resend it.`
      : `${salutation}, bas ek quick follow-up. Agar aap Gigxomi try karna chahte hain aur agency registration link dobara chahiye, yahin reply kar dijiye.`;
  }

  if (category === "REGISTERED_TRAINING_PENDING") {
    return english
      ? `${salutation}, your agency registration is complete. When convenient, send one setup/training time between 10 AM and 7 PM.`
      : `${salutation}, aapki agency registration complete ho gayi hai. Setup/training ke liye 10 AM se 7 PM ke beech ek convenient time bhej dijiye.`;
  }

  return null;
}

function createState(
  conversation: { id: string; customerPhone?: string; customerPhoneDisplay?: string; customerName?: string; customerDisplayName?: string },
  category: DripAudienceCategory,
): ConversationDripState {
  return {
    conversationId: conversation.id,
    customerPhone: conversation.customerPhone || conversation.customerPhoneDisplay || "",
    customerName: conversation.customerName || conversation.customerDisplayName || "Customer",
    audienceCategory: category,
    currentStage: 0,
    paused: false,
    completed: false,
    history: [],
  };
}

/**
 * Runs one safe evaluation cycle. There is no broad 4-stage sequence: at most
 * one reminder is sent after a specific previous action, and no message is
 * dispatched after an opt-out, human handoff, booking or a fresh user reply.
 */
async function evaluateAndDispatchLeadDripsOnce(): Promise<{
  evaluated: number;
  dispatched: number;
  skipped: number;
  outsideHours: boolean;
}> {
  const insideHours = isInsideIstWorkingHours();
  const summary = { evaluated: 0, dispatched: 0, skipped: 0, outsideHours: !insideHours };
  if (!insideHours) return summary;

  const dripStore = await loadDripStore();
  const payload = await listConversationsForAudienceFromFile("sales", { lightweight: false });
  const conversations = Array.isArray(payload?.conversations) ? payload.conversations : [];
  const now = Date.now();

  for (const conversation of conversations) {
    if (!conversation?.id || !conversation.customerPhoneDisplay) continue;
    summary.evaluated++;

    const statusId = String(conversation.leadStatusId || conversation.status || "new").trim().toLowerCase();
    const messages = (conversation.messages || []) as ConversationMessage[];
    const terminalStatus = ["closed", "paid", "training-booked", "not-interested", "human-review", "lost"];
    if (conversation.aiAutoReplyDisabled || terminalStatus.includes(statusId) || messages.length === 0) {
      summary.skipped++;
      continue;
    }

    const decision = getContextAwareFollowUpDecision({ messages, leadStatusId: statusId });
    let state = dripStore[conversation.id];

    if (!decision) {
      if (hasConversationOptOut(messages)) {
        state ||= createState(conversation, "NONE");
        state.paused = true;
        state.completed = true;
        state.pauseReason = "customer_opt_out";
        state.pausedAt = new Date().toISOString();
        dripStore[conversation.id] = state;
      }
      summary.skipped++;
      continue;
    }

    if (!state) {
      state = createState(conversation, decision.category);
      dripStore[conversation.id] = state;
    }

    if (state.paused || state.completed || state.currentStage >= 1 || state.history.some((entry) => entry.purpose === decision.purpose)) {
      summary.skipped++;
      continue;
    }

    const lastCustomerMessage = [...messages].reverse().find(isCustomerMessage);
    const lastAssistantMessage = messages[messages.length - 1];
    const lastCustomerAt = new Date(String(lastCustomerMessage?.createdAt || "")).getTime();
    const lastAssistantAt = new Date(String(lastAssistantMessage?.createdAt || "")).getTime();
    if (!Number.isFinite(lastCustomerAt) || !Number.isFinite(lastAssistantAt)) {
      summary.skipped++;
      continue;
    }

    const hoursSinceCustomer = (now - lastCustomerAt) / 3_600_000;
    const hoursSinceAction = (now - lastAssistantAt) / 3_600_000;
    // No free-form follow-up beyond WhatsApp's regular customer window.
    if (hoursSinceCustomer < 0 || hoursSinceCustomer > MAX_CUSTOMER_WINDOW_HOURS || hoursSinceAction < decision.delayHours) {
      state.audienceCategory = decision.category;
      state.nextScheduledAt = new Date(lastAssistantAt + decision.delayHours * 3_600_000).toISOString();
      summary.skipped++;
      continue;
    }

    const content = getDripMessageContent(
      decision.category,
      1,
      String(conversation.customerDisplayName || "").split(/\s+/)[0] || "",
      isEnglishLead(messages),
    );
    if (!content) {
      summary.skipped++;
      continue;
    }

    try {
      // Read authoritative DB immediately before dispatch, bypassing the UI cache.
      const row = await prisma.appConversation.findUnique({ where: { id: conversation.id }, select: { payload: true } });
      const current = row?.payload as unknown as { messages: ConversationMessage[]; aiAutoReplyDisabled?: boolean; leadStatusId: string; customerPhone: string } | undefined;
      const signature = (items: ConversationMessage[]) => digest(items.map(m => [isCustomerMessage(m), messageBody(m), m.createdAt]));
      const freshDecision = current && getContextAwareFollowUpDecision({ messages: current.messages, leadStatusId: current.leadStatusId });
      if (!current || current.aiAutoReplyDisabled || terminalStatus.includes(current.leadStatusId) || !freshDecision || freshDecision.purpose !== decision.purpose || signature(current.messages) !== signature(messages)) {
        summary.skipped++; continue;
      }
      const registered = await getLeadAgencyRegistrationStateByPhone(current.customerPhone);
      if (registered === null || registered === undefined || (decision.category === "REGISTERED_TRAINING_PENDING" ? !registered : registered)) { summary.skipped++; continue; }
      const lastCheck = await prisma.appConversation.findUnique({ where: { id: conversation.id }, select: { payload: true } });
      if (digest(lastCheck?.payload) !== digest(row?.payload)) { summary.skipped++; continue; }
      await deliverConversationMessageFromFile(conversation.id, { role: "admin", body: content, lane: "customer" });
      const sentAt = new Date().toISOString();
      state.audienceCategory = decision.category;
      state.currentStage = 1;
      state.lastDripSentAt = sentAt;
      state.nextScheduledAt = undefined;
      state.completed = true;
      state.history.push({ stage: 1, sentAt, body: content, purpose: decision.purpose });
      summary.dispatched++;
      console.log(`[WHATSAPP_LEAD_DRIP] Sent one ${decision.purpose} reminder to ${conversation.id}`);
    } catch (err) {
      console.error(`[WHATSAPP_LEAD_DRIP] Failed to send ${decision.purpose} reminder for ${conversation.id}:`, err);
    }
  }

  await saveDripStore(dripStore);
  return summary;
}

/** One process may receive overlapping scheduler ticks; share the same run so
 * the same customer cannot receive duplicate WhatsApp reminders. */
export async function evaluateAndDispatchLeadDrips(): Promise<{
  evaluated: number;
  dispatched: number;
  skipped: number;
  outsideHours: boolean;
}> {
  // A second scheduler tick while a run is still evaluating must not claim a
  // second send. It reports an empty cycle rather than duplicating delivery.
  if (activeDripEvaluation) {
    return { evaluated: 0, dispatched: 0, skipped: 0, outsideHours: false };
  }
  const execution = evaluateAndDispatchLeadDripsOnce();
  activeDripEvaluation = execution;
  try {
    return await execution;
  } finally {
    if (activeDripEvaluation === execution) activeDripEvaluation = null;
  }
}

export async function getConversationDripStatus(conversationId: string): Promise<ConversationDripState | null> {
  const dripStore = await loadDripStore();
  let state = dripStore[conversationId];
  if (!state) {
    const conversation = await getConversationByIdFromFile(conversationId);
    if (!conversation) return null;
    const decision = getContextAwareFollowUpDecision({
      messages: (conversation.messages || []) as ConversationMessage[],
      leadStatusId: conversation.leadStatusId,
    });
    state = createState(conversation, decision?.category || "NONE");
    dripStore[conversationId] = state;
    await saveDripStore(dripStore);
  }
  return state;
}

export async function setConversationDripPaused(
  conversationId: string,
  paused: boolean,
): Promise<ConversationDripState | null> {
  const dripStore = await loadDripStore();
  let state = dripStore[conversationId];
  if (!state) {
    const conversation = await getConversationByIdFromFile(conversationId);
    if (!conversation) return null;
    const decision = getContextAwareFollowUpDecision({
      messages: (conversation.messages || []) as ConversationMessage[],
      leadStatusId: conversation.leadStatusId,
    });
    state = createState(conversation, decision?.category || "NONE");
  }
  state.paused = paused;
  if (paused) {
    state.completed = true;
    state.pauseReason = "manual";
    state.pausedAt = new Date().toISOString();
  } else {
    delete state.pauseReason;
    delete state.pausedAt;
  }
  dripStore[conversationId] = state;
  await saveDripStore(dripStore);
  return state;
}
