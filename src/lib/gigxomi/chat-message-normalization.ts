const PROJECT_OFFER_TIMEOUT_PREFIX = "project offer timed out";

export type SharedChatAudience = "customer" | "manager" | "admin" | "freelancer" | "sales";
export type SharedChatLane = "customer" | "internal";

export function isConversationMessageIncomingForAudience(
  message: { body?: string; lane: SharedChatLane; senderRole: SharedChatAudience },
  audience: SharedChatAudience,
) {
  if (isAutomatedAssignmentOutcomeMessageBody(message.body ?? "")) {
    return true;
  }

  if (message.lane === "customer") {
    return audience === "customer" ? message.senderRole !== "customer" : message.senderRole === "customer";
  }

  return message.senderRole !== audience;
}

export function isAutomatedAssignmentOutcomeMessageBody(body: string) {
  return body.trim().toLowerCase().startsWith(PROJECT_OFFER_TIMEOUT_PREFIX);
}

export function normalizeAutomatedChatMessageBody(body: string) {
  const trimmedBody = body.trim();
  if (!isAutomatedAssignmentOutcomeMessageBody(trimmedBody)) {
    return body;
  }

  const timeoutMatch = trimmedBody.match(
    /^Project offer timed out for .+?,\s*(.+?)\.\s*(?:Response-time Karma\b.*)?$/i,
  );
  const freelancerName = timeoutMatch?.[1]?.trim();

  return freelancerName ? `${freelancerName} did not accept this offer.` : "The freelancer did not accept this offer.";
}
