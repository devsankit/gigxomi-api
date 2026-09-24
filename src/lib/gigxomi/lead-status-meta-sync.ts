import "server-only";

import { getConversationByIdFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { publishConversationRealtimeEvent } from "@/lib/gigxomi/conversation-realtime";

// These states mean a human can review an agency lead. They deliberately do
// not include editor app installs, generic project statuses, or a loose
// "interested" reply.
const HUMAN_QUALIFIED_AGENCY_STATUS_SET = new Set([
  "qualified-agency",
  "agency-registered",
  "agency-connected",
  "training-booked",
]);

export function isHumanQualifiedAgencyStatus(leadStatusId: string) {
  return HUMAN_QUALIFIED_AGENCY_STATUS_SET.has(String(leadStatusId || "").trim().toLowerCase());
}

export type LeadStatusSyncResult = {
  ok: boolean;
  statusId: string;
  isQualified: boolean;
  meta: {
    enqueued: boolean;
    sent: boolean;
    manualReviewRequired?: boolean;
  };
};

export async function syncLeadStatusToMetaAndOutbox(input: {
  conversationId: string;
  leadStatusId: string;
  notes?: string;
  actorUserId?: string;
}): Promise<LeadStatusSyncResult> {
  const { conversationId, leadStatusId } = input;
  const statusKey = String(leadStatusId || "").trim().toLowerCase();
  const isQualified = isHumanQualifiedAgencyStatus(statusKey);

  // Status updates always publish a realtime CRM refresh. They never create a
  // Meta conversion by themselves: a status can be set accidentally, and it
  // does not prove a Click-to-WhatsApp referral or human qualification.
  const conversation = await getConversationByIdFromFile(conversationId);

  // 2. Publish realtime event to Closer app SSE
  try {
    if (conversation) {
      await publishConversationRealtimeEvent({
        conversationId,
        eventType: "conversation-updated",
        tenantId: conversation.tenantId,
      });
    }
  } catch (err) {
    console.error("[lead-status-meta-sync] Realtime SSE dispatch error:", err);
  }

  return {
    ok: true,
    statusId: leadStatusId,
    isQualified,
    meta: {
      enqueued: false,
      sent: false,
      manualReviewRequired: isQualified,
    },
  };
}
