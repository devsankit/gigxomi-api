import "server-only";

import { prisma } from "@/lib/prisma";
import { syncLeadStatusToMetaAndOutbox } from "./lead-status-meta-sync";
import {
  updateConversationLeadStatusFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";

export type QualificationCandidate = {
  shouldPromote: boolean;
  targetStatus: "qualified" | "training-booked" | "agency-connected" | null;
  reason: string;
};

const STATUS_PRIORITY: Record<string, number> = {
  new: 0,
  "new-leads": 0,
  contacted: 1,
  qualified: 2,
  "training-booked": 3,
  "webinar-invited": 3,
  "agency-connected": 4,
  "app-installed": 4,
  "in-progress": 4,
  "work-done": 4,
  delivered: 4,
  closed: 5,
  "closed-won": 5,
  paid: 5,
};

// Agency / Entrepreneur signals
const AGENCY_PATTERNS = [
  /\b(?:agency owner|my agency|meri agency|our agency|video editing agency|editing agency|production house|designing agency|branding agency|content agency|creative agency)\b/i,
  /\b(?:run\s+[^.!?\n]{0,80}agency|manage\s+[^.!?\n]{0,80}editors|team\s+of\s+[^.!?\n]{0,30}editors|\b\d+\s+editors\b|have\s+[^.!?\n]{0,30}editors)\b/i,
  /\b(?:client projects|client workflow|client revisions|client communication|handle clients|manage clients)\b/i,
];

// Freelancer / Job Seeker signals (People looking for work/editing jobs, NOT agency clients)
const FREELANCER_JOB_SEEKER_PATTERNS = [
  /\b(?:kaam chahiye|work chahiye|job chahiye|hiring|vacancy|hire me|freelance (?:editor|work)|editing ka kaam|editor looking for|seeking (?:job|work)|internship|part time|sample video|demo send karu|meri editing dekhlo|sample bheju|portfolio bheju|mujhe kaam|kya kaam milega|mujhe hire|editor hu|video editor hu|freelancer hu|client dila do|client chahiye|work provide|need work|need projects|work available)\b/i,
  /\b(?:fresher|experience \d|premiere pro.*after effects|davinci.*capcut)\b/i,
];

// Trial / Demo / Meeting Time Confirmation signals
const TIME_CONFIRMATION_PATTERNS = [
  /\b(?:tomorrow|kal|aaj|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)|1pm|2pm|3pm|4pm|5pm|6pm|7pm|11am|12pm)\b/i,
  /\b(?:test ready|ready for trial|trial chahiye|start trial|ready to test|practical test|setup (?:kardo|kar do|karwa do))\b/i,
];

// Portfolio / Professional credentials signals
const PORTFOLIO_PATTERNS = [
  /\b(?:resume|cv|portfolio|showreel|behance|drive\.google\.com|notion\.site|vimeo)\b/i,
  /\b(?:Document:\s*[^.\n]+\.(?:pdf|docx?))\b/i,
];

export function detectLeadQualificationState(input: {
  currentStatus?: string;
  messages: Array<{ role?: string; senderRole?: string; body?: string; content?: string }>;
}): QualificationCandidate {
  const currentKey = String(input.currentStatus || "new").toLowerCase().trim();
  const currentLevel = STATUS_PRIORITY[currentKey] ?? 0;

  // Extract all customer texts and assistant texts
  const customerTexts: string[] = [];
  const allTexts: string[] = [];

  for (const m of input.messages || []) {
    const role = m.role || m.senderRole || "";
    const text = String(m.body || m.content || "").trim();
    if (!text) continue;
    allTexts.push(text);
    if (role === "customer" || role === "user") {
      customerTexts.push(text);
    }
  }

  const combinedCustomerText = customerTexts.join(" ");
  const combinedAllText = allTexts.join(" ");

  // 0. If the customer is an editor / freelancer looking for work, DO NOT auto-promote to agency training or qualified!
  const isJobSeeker = FREELANCER_JOB_SEEKER_PATTERNS.some((p) => p.test(combinedCustomerText));
  if (isJobSeeker) {
    return {
      shouldPromote: false,
      targetStatus: null,
      reason: "Customer identified as freelance editor / job seeker looking for work (not an agency founder)",
    };
  }

  // 1. Check for Trial / Setup Time Confirmation -> "training-booked" (Meta CAPI: Schedule)
  // Target Level: 3
  if (currentLevel < STATUS_PRIORITY["training-booked"]) {
    const hasTimeConfirmation = TIME_CONFIRMATION_PATTERNS.some((p) => p.test(combinedCustomerText));
    const hasAffirmation = /\b(yes|ha|haan|sure|done|okay|ok|theek hai|bilkul)\b/i.test(combinedCustomerText);
    const hasExplicitAgencyContext =
      AGENCY_PATTERNS.some((p) => p.test(combinedAllText)) ||
      /(?:agency|workflow|crm|software|trial|demo|walkthrough|gigxomi|client management)/i.test(combinedAllText);
    const hasConfirmationEcho = /(?:confirmation di hai|session .* confirm hai|setup complete kar degi)/i.test(combinedAllText);

    if (hasExplicitAgencyContext && ((hasTimeConfirmation && hasAffirmation) || hasConfirmationEcho)) {
      return {
        shouldPromote: true,
        targetStatus: "training-booked",
        reason: "Agency customer confirmed trial / demo appointment time",
      };
    }
  }

  // 2. Check for Agency Founder / Business Mindset -> "qualified" (Meta CAPI: Lead)
  // Target Level: 2
  if (currentLevel < STATUS_PRIORITY["qualified"]) {
    const isAgencyFounder = AGENCY_PATTERNS.some((p) => p.test(combinedCustomerText));
    if (isAgencyFounder) {
      return {
        shouldPromote: true,
        targetStatus: "qualified",
        reason: "Customer identified as video agency owner / team lead",
      };
    }
  }

  return {
    shouldPromote: false,
    targetStatus: null,
    reason: "No qualification threshold met",
  };
}

export async function evaluateAndApplyWhatsAppLeadQualification(input: {
  conversationId: string;
  tenantId?: string;
  customerPhone: string;
  rawMessages: Array<Record<string, unknown>>;
  actorUserId?: string;
}): Promise<{ promoted: boolean; targetStatus?: string; reason?: string; metaResult?: unknown }> {
  const { conversationId, customerPhone, rawMessages, tenantId, actorUserId } = input;

  // 1. Fetch current conversation to check status
  let currentStatus = "new";
  if (process.env.DATABASE_URL?.trim()) {
    try {
      const dbRow = await prisma.appConversation.findUnique({
        where: { id: conversationId },
        select: { leadStatusId: true, payload: true },
      });
      if (dbRow?.leadStatusId) {
        currentStatus = dbRow.leadStatusId;
      }
    } catch {
      // fallback
    }
  }

  // 2. Evaluate qualification
  const decision = detectLeadQualificationState({
    currentStatus,
    messages: rawMessages as Array<{ role?: string; senderRole?: string; body?: string; content?: string }>,
  });

  if (!decision.shouldPromote || !decision.targetStatus) {
    return { promoted: false };
  }

  const targetStatus = decision.targetStatus;
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const autoNote = `[Auto-CAPI-Qualified] Promoted to ${targetStatus}: ${decision.reason} (${timestamp})`;

  console.log(`[AutoQualification] Promoting ${conversationId} (${customerPhone}) from '${currentStatus}' to '${targetStatus}' (${decision.reason})`);

  // 3. Update in PostgreSQL
  if (process.env.DATABASE_URL?.trim()) {
    try {
      const existing = await prisma.appConversation.findUnique({
        where: { id: conversationId },
      });
      if (existing) {
        const payloadObj =
          existing.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload)
            ? (existing.payload as Record<string, unknown>)
            : {};
        const prevNotes = String(payloadObj.internalNotes ?? "").trim();
        const mergedNotes = prevNotes ? `${prevNotes}\n${autoNote}` : autoNote;

        await prisma.appConversation.update({
          where: { id: conversationId },
          data: {
            leadStatusId: targetStatus,
            payload: {
              ...payloadObj,
              leadStatusId: targetStatus,
              internalNotes: mergedNotes,
              autoQualifiedAt: new Date().toISOString(),
              autoQualifiedReason: decision.reason,
            },
            updatedAt: new Date(),
          },
        });
      }
    } catch (err) {
      console.error("[AutoQualification] DB update error:", err);
    }
  }

  // 4. Update file store if present
  try {
    await updateConversationLeadStatusFromFile(conversationId, targetStatus).catch(() => null);
  } catch {
    // ignore
  }

  // 5. Sync to Meta CAPI & Realtime SSE
  try {
    const metaSync = await syncLeadStatusToMetaAndOutbox({
      conversationId,
      leadStatusId: targetStatus,
      notes: autoNote,
      actorUserId: actorUserId || "system:whatsapp-auto-qualifier",
    });

    return {
      promoted: true,
      targetStatus,
      reason: decision.reason,
      metaResult: metaSync,
    };
  } catch (syncErr) {
    console.error("[AutoQualification] Meta CAPI sync error:", syncErr);
    return {
      promoted: true,
      targetStatus,
      reason: decision.reason,
    };
  }
}
