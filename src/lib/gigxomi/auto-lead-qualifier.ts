import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/auth/normalize";
import {
  getDummyPlatformSnapshot,
  type DummyConversation,
} from "@/lib/gigxomi/dummy-platform-store";
import {
  withSnapshot,
  getConversationByIdFromFile,
  deliverConversationMessageFromFile,
  updateConversationLeadStatusFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { syncLeadStatusToMetaAndOutbox } from "./lead-status-meta-sync";

function normalizeDigits(value: unknown): string {
  return String(value ?? "").replace(/[^\d]/g, "");
}

function phonesMatch(phoneA: string, phoneB: string): boolean {
  const a = normalizeDigits(phoneA);
  const b = normalizeDigits(phoneB);
  if (!a || !b) return false;
  if (a === b) return true;
  const aLast10 = a.slice(-10);
  const bLast10 = b.slice(-10);
  return aLast10.length === 10 && aLast10 === bLast10;
}

function hasCustomerOptedOut(messages: Array<{ role?: string; senderRole?: string; body?: string }>) {
  return messages.some((message) => {
    const isCustomer = message.role === "customer" || message.senderRole === "customer" || message.role === "user";
    if (!isCustomer) return false;
    return /(?:^|\b)(?:stop|unsubscribe|do\s+not\s+contact|don't\s+contact|dont\s+contact|not\s+interested|no\s+thanks|i\s+(?:don't|dont|do\s+not)\s+wanna|i\s+(?:don't|dont|do\s+not)\s+want|nahi\s+chahiye|baat\s+nahi\s+karni|message\s+mat|band\s+karo)(?:\b|$)/i.test(String(message.body ?? ""));
  });
}

function isEnglishCustomerMessage(text: string) {
  return /\b(?:i|we|you|the|and|from|your|how|what|can|please|yes|no|registration|account)\b/i.test(text) &&
    !/\b(?:aap|ap|hai|hain|kaise|karna|karte|mujhe|mera|meri|nahi|haan|ji)\b/i.test(text);
}

/**
 * Sends one onboarding invitation only after an actual agency registration is
 * verified. It uses the exact CRM conversation selected by the status update,
 * honours opt-outs/human takeover, and stays inside the customer-initiated
 * WhatsApp window. A duplicate welcome is never sent.
 */
export async function sendVerifiedAgencyRegistrationWelcome(input: { conversationId: string }) {
  const conversation = await getConversationByIdFromFile(input.conversationId).catch(() => null);
  if (!conversation || conversation.sourceChannel !== "whatsapp" || conversation.aiAutoReplyDisabled) return false;

  const messages = (conversation.messages || []) as Array<{
    role?: string;
    senderRole?: string;
    body?: string;
    createdAt?: string;
  }>;
  if (hasCustomerOptedOut(messages)) return false;
  const hasWelcome = messages.some((message) =>
    (message.role === "admin" || message.senderRole === "admin") &&
    /(?:congratulations|registration complete|registration is complete|registration complete ho)/i.test(String(message.body ?? "")) &&
    /(?:setup|training|onboarding)/i.test(String(message.body ?? "")),
  );
  if (hasWelcome) return false;

  const lastCustomerMessage = [...messages].reverse().find((message) =>
    message.role === "customer" || message.senderRole === "customer" || message.role === "user",
  );
  const lastCustomerAt = new Date(String(lastCustomerMessage?.createdAt ?? "")).getTime();
  if (!Number.isFinite(lastCustomerAt) || Date.now() - lastCustomerAt > 23 * 60 * 60 * 1000) return false;

  const english = isEnglishCustomerMessage(String(lastCustomerMessage?.body ?? ""));
  const body = english
    ? "Congratulations, your Gigxomi agency registration is complete. Please share one convenient setup/training time between 10 AM and 7 PM."
    : "Congratulations, aapki Gigxomi agency registration complete ho gayi hai. Setup/training ke liye 10 AM se 7 PM ke beech ek convenient time bhej dijiye.";

  const delivery = await deliverConversationMessageFromFile(input.conversationId, {
    role: "admin",
    lane: "customer",
    body,
  }).catch(() => null);
  return Boolean(delivery);
}

/** Read the source-of-truth agency registration state for safe onboarding decisions. */
export async function getLeadAgencyRegistrationStateByPhone(phone: string): Promise<boolean | null> {
  if (!phone || !process.env.DATABASE_URL?.trim()) return null;
  const normalized = normalizePhone(phone);
  const digits = normalizeDigits(normalized);
  const candidates = Array.from(new Set([
    normalized,
    digits,
    digits.startsWith("91") ? `+${digits}` : null,
    digits.startsWith("91") ? digits.slice(2) : null,
    digits.length === 10 ? `+91${digits}` : null,
    digits.length === 10 ? `91${digits}` : null,
  ].filter((value): value is string => Boolean(value))));
  if (!candidates.length) return null;

  try {
    const user = await prisma.appAuthUser.findFirst({
      where: {
        OR: candidates.flatMap((candidate) => [
          { phone: candidate },
          { loginPhoneAliases: { has: candidate } },
        ]),
      },
      select: { role: true, packageAudience: true, workspaceMode: true },
    });
    if (!user) return false;
    return user.packageAudience === "AGENCY" || user.workspaceMode === "AGENCY" || user.role === "ADMIN";
  } catch (error) {
    console.error("[auto-lead-qualifier] Registration-state lookup error:", error);
    return null;
  }
}

export type AutoQualifyResult = {
  ok: boolean;
  matchedConversationId: string | null;
  statusApplied: string;
  reason: string;
  metaDelivered: boolean;
  traceId?: string;
};

export async function autoQualifyLeadByCustomerPhone(input: {
  phone: string;
  /** Exact conversation prevents matching another WhatsApp account with the same customer phone. */
  conversationId?: string;
  targetStatus: "agency-registered" | "agency-connected" | "app-installed" | "qualified-agency";
  reason: string;
  email?: string;
  userId?: string;
}): Promise<AutoQualifyResult> {
  const targetPhone = input.phone;
  if (!targetPhone) {
    return {
      ok: false,
      matchedConversationId: null,
      statusApplied: input.targetStatus,
      reason: "No phone number provided",
      metaDelivered: false,
    };
  }

  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const autoNote = `[Auto-Qualified] ${input.reason} (${timestamp})`;

  // 1. Search in platform file/memory store across all sales conversations
  const snapshot = await withSnapshot(() => getDummyPlatformSnapshot(), { persist: false });
  const memoryMatches = snapshot.conversations.filter((c: DummyConversation) =>
    (!input.conversationId || c.id === input.conversationId) && phonesMatch(c.customerPhone ?? "", targetPhone),
  );
  const matchedConv = input.conversationId
    ? memoryMatches[0]
    : memoryMatches.length === 1
      ? memoryMatches[0]
      : undefined;

  let matchedConversationId: string | null = matchedConv?.id ?? null;

  // 2. Search database if not found in memory snapshot
  if (!matchedConversationId && process.env.DATABASE_URL?.trim()) {
    try {
      const dbConvs = await prisma.appConversation.findMany({
        where: {
          ...(input.conversationId
            ? { id: input.conversationId }
            : {
                OR: [
                  { tenantId: "tenant-agency-408de269" },
                  { tenantId: "tenant-gigxomi" },
                  { tenantId: { startsWith: "tenant-gigxomi-sales-agent-" } },
                ],
              }),
        },
        select: { id: true, customerPhone: true, payload: true },
        take: input.conversationId ? 1 : 300,
        orderBy: { updatedAt: "desc" },
      });

      const matchingDbConversations = dbConvs.filter((conv) => phonesMatch(conv.customerPhone ?? "", targetPhone));
      if (input.conversationId) {
        matchedConversationId = matchingDbConversations[0]?.id ?? null;
      } else if (matchingDbConversations.length === 1) {
        matchedConversationId = matchingDbConversations[0].id;
      }
    } catch (err) {
      console.error("[auto-lead-qualifier] DB lookup error:", err);
    }
  }

  const metaDelivered = false;

  // 3. Update conversation in file store & DB if matched
  if (matchedConversationId) {
    try {
      await updateConversationLeadStatusFromFile(matchedConversationId, input.targetStatus);

      // Append note and update in Postgres
      if (process.env.DATABASE_URL?.trim()) {
        try {
          const existing = await prisma.appConversation.findUnique({
            where: { id: matchedConversationId },
          });
          if (existing) {
            const currentPayload =
              existing.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload)
                ? (existing.payload as Record<string, unknown>)
                : {};
            const prevNotes = String(currentPayload.internalNotes ?? "").trim();
            const mergedNotes = prevNotes ? `${prevNotes}\n${autoNote}` : autoNote;

            await prisma.appConversation.update({
              where: { id: matchedConversationId },
              data: {
                leadStatusId: input.targetStatus,
                payload: {
                  ...currentPayload,
                  leadStatusId: input.targetStatus,
                  internalNotes: mergedNotes,
                  autoQualifiedAt: new Date().toISOString(),
                },
                updatedAt: new Date(),
              },
            });
          }
        } catch (dbErr) {
          console.error("[auto-lead-qualifier] DB status update error:", dbErr);
        }
      }

      // Refresh the CRM in real time. Meta CAPI is sent only from the explicit,
      // audited sales qualification action after verified CTWA attribution.
      await syncLeadStatusToMetaAndOutbox({
        conversationId: matchedConversationId,
        leadStatusId: input.targetStatus,
        notes: autoNote,
        actorUserId: input.userId,
      });
    } catch (err) {
      console.error("[auto-lead-qualifier] Update conversation error:", err);
    }
  }

  return {
    ok: true,
    matchedConversationId,
    statusApplied: input.targetStatus,
    reason: input.reason,
    metaDelivered,
  };
}

export async function markLeadTrainingBookedByPhone(input: {
  phone: string;
  conversationId?: string;
  notes?: string;
  senderName?: string;
}): Promise<AutoQualifyResult> {
  const targetPhone = input.phone;
  if (!targetPhone) {
    return {
      ok: false,
      matchedConversationId: null,
      statusApplied: "training-booked",
      reason: "No phone number provided",
      metaDelivered: false,
    };
  }

  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const autoNote = `[Walkthrough Booked] Lead agreed to 1-on-1 Google Meet training/walkthrough during working hours (10 AM - 7 PM). Notes: ${input.notes ?? "Requested via AI bot"} (${timestamp})`;

  // 1. Search in platform file/memory store across all sales conversations
  const snapshot = await withSnapshot(() => getDummyPlatformSnapshot(), { persist: false });
  const matchedConv = input.conversationId
    ? snapshot.conversations.find((c: DummyConversation) => c.id === input.conversationId && phonesMatch(c.customerPhone ?? "", targetPhone))
    : snapshot.conversations.find((c: DummyConversation) => phonesMatch(c.customerPhone ?? "", targetPhone));

  let matchedConversationId: string | null = matchedConv?.id ?? null;

  // 2. Search database if not found in memory snapshot
  if (!matchedConversationId && input.conversationId && process.env.DATABASE_URL?.trim()) {
    try {
      const exactConversation = await prisma.appConversation.findUnique({
        where: { id: input.conversationId },
        select: { id: true, customerPhone: true },
      });
      if (exactConversation && phonesMatch(exactConversation.customerPhone ?? "", targetPhone)) {
        matchedConversationId = exactConversation.id;
      }
    } catch (err) {
      console.error("[auto-lead-qualifier] Exact conversation lookup error:", err);
    }
  }

  if (!matchedConversationId && !input.conversationId && process.env.DATABASE_URL?.trim()) {
    try {
      const dbConvs = await prisma.appConversation.findMany({
        where: {
          OR: [
            { tenantId: "tenant-agency-408de269" },
            { tenantId: "tenant-gigxomi" },
            { tenantId: { startsWith: "tenant-gigxomi-sales-agent-" } },
          ],
        },
        select: { id: true, customerPhone: true, payload: true },
        take: 300,
        orderBy: { updatedAt: "desc" },
      });

      for (const conv of dbConvs) {
        if (phonesMatch(conv.customerPhone ?? "", targetPhone)) {
          matchedConversationId = conv.id;
          break;
        }
      }
    } catch (err) {
      console.error("[auto-lead-qualifier] DB search error:", err);
    }
  }

  if (!matchedConversationId) {
    return {
      ok: false,
      matchedConversationId: null,
      statusApplied: "training-booked",
      reason: `No conversation found matching phone ${targetPhone}`,
      metaDelivered: false,
    };
  }

  // 3. Update status in dummy file store
  await updateConversationLeadStatusFromFile(matchedConversationId, "training-booked", autoNote);

  // 4. Update in Prisma DB if available
  if (process.env.DATABASE_URL?.trim()) {
    try {
      const dbConv = await prisma.appConversation.findUnique({ where: { id: matchedConversationId } });
      if (dbConv) {
        const payloadObj =
          dbConv.payload && typeof dbConv.payload === "object" && !Array.isArray(dbConv.payload)
            ? (dbConv.payload as Record<string, unknown>)
            : {};
        const previousNotes = String(payloadObj.internalNotes ?? "").trim();
        await prisma.appConversation.update({
          where: { id: matchedConversationId },
          data: {
            leadStatusId: "training-booked",
            payload: {
              ...payloadObj,
              leadStatusId: "training-booked",
              leadStatusTone: "accent",
              leadStatusUpdatedAt: new Date().toISOString(),
              internalNotes: previousNotes ? `${previousNotes}\n${autoNote}` : autoNote,
            },
          },
        });
      }
    } catch (err) {
      console.error("[auto-lead-qualifier] DB update error:", err);
    }
  }

  // 5. Refresh the CRM. A status is not a Meta conversion: the explicit sales
  // qualification flow verifies Click-to-WhatsApp attribution before sending.
  await syncLeadStatusToMetaAndOutbox({
    conversationId: matchedConversationId,
    leadStatusId: "training-booked",
    notes: autoNote,
  });

  return {
    ok: true,
    matchedConversationId,
    statusApplied: "training-booked",
    reason: autoNote,
    metaDelivered: false,
  };
}
