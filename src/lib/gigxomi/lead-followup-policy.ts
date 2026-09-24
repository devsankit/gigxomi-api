type FollowupMessage = {
  role?: unknown;
  senderRole?: unknown;
  createdAt?: unknown;
  body?: unknown;
  content?: unknown;
};

const TERMINAL_LEAD_STATUSES = new Set([
  "closed",
  "closed won",
  "closed lost",
  "won",
  "paid",
  "registered",
  "agency registered",
  "freelancer registered",
  "onboarding complete",
  "not interested",
  "lost",
  "do not contact",
  "dnc",
  "training booked",
  "training-booked",
]);

export function isTerminalLeadStatus(status: unknown): boolean {
  const normalized = String(status || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return TERMINAL_LEAD_STATUSES.has(normalized);
}

export function isLatestMessageFromCustomer(messages: readonly FollowupMessage[]): boolean {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage) return false;
  const role = String(latestMessage.role || "").toLowerCase();
  const senderRole = String(latestMessage.senderRole || "").toLowerCase();
  return [role, senderRole].some((value) => ["customer", "user"].includes(value));
}

export function getLatestOutboundMessageTime(messages: readonly FollowupMessage[]): number | null {
  let latestTime: number | null = null;

  for (const message of messages) {
    const role = String(message.role || "").toLowerCase();
    const senderRole = String(message.senderRole || "").toLowerCase();
    const isOutbound = [role, senderRole].some((value) =>
      ["assistant", "admin", "agent", "sales"].includes(value),
    );
    if (!isOutbound) continue;

    const timestamp = new Date(String(message.createdAt || "")).getTime();
    if (!Number.isFinite(timestamp)) continue;
    latestTime = latestTime === null ? timestamp : Math.max(latestTime, timestamp);
  }

  return latestTime;
}

export function hasRecentOutboundActivity(
  messages: readonly FollowupMessage[],
  now: number,
  minimumGapHours: number,
): boolean {
  const latestOutbound = getLatestOutboundMessageTime(messages);
  return latestOutbound !== null && now - latestOutbound < minimumGapHours * 60 * 60 * 1000;
}

export function isWithinIstLeadContactHours(at: Date): boolean {
  try {
    const currentTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
    return currentTime >= "10:00" && currentTime < "19:00";
  } catch {
    return false;
  }
}

function textOf(message: FollowupMessage): string {
  return String(message.body ?? message.content ?? "").trim();
}

function isCustomerMessage(message: FollowupMessage): boolean {
  const role = String(message.role || "").toLowerCase();
  const senderRole = String(message.senderRole || "").toLowerCase();
  return [role, senderRole].some((value) => ["customer", "user"].includes(value));
}

function isOutboundMessage(message: FollowupMessage): boolean {
  const role = String(message.role || "").toLowerCase();
  const senderRole = String(message.senderRole || "").toLowerCase();
  return [role, senderRole].some((value) => ["assistant", "admin", "agent", "sales"].includes(value));
}

const CUSTOMER_WORKFLOW_PAIN = /\b(?:revision|revisions|briefs?|deadlines?|assign(?:ment|ing)?|client chats?|coordination|workload|capacity|overloaded|scattered|separate chats|copy.?paste|miss(?:ed|ing)? (?:a )?(?:deadline|revision|update)|time consuming|takes too much time|manage karna mushkil|track karna mushkil|kaise manage|kaise track|alag alag track)\b/i;
const CUSTOMER_JOB_SEARCH = /\b(?:project chahiye|projects? nahi mil|need projects?|looking for (?:work|a job|projects?|editing work)|came here for (?:a )?project|hire me|are you hiring|job provide|need clients?|clients? nahi mil|work from home (?:job|opportunity)|seat available)\b/i;
const CUSTOMER_NO_WORKFLOW_NEED = /\b(?:no problem|no issues?|nothing to improve|all good|works? fine|everything is fine|sab (?:manage|theek) ho jata|koi problem nahi|kuch nahi|kuch bhi issue nahi|koi dikkat nahi|no challenge|not facing any|don't have any (?:problem|issue|challenge))\b/i;
const CUSTOMER_SUPPORT_ISSUE = /\b(?:otp|login|log in|sign.?up (?:error|issue|fail)|app (?:is )?not working|not working|unable to|can't (?:login|log in|go forward|connect)|cannot (?:login|log in|connect)|error|bug|technical issue|glitch|failed|failure|need support|support issue|i don't understand|not receiving|not opening)\b/i;
const HUMAN_REQUEST = /\b(?:talk to (?:a )?(?:human|person|real person)|speak to (?:a )?(?:human|person|real person)|person not ai|not an? ai|connect me (?:to|with) (?:a )?(?:human|person)|human agent)\b/i;
const HANDOFF_COMMITMENT = /\b(?:team|representative|staff)\b.{0,70}\b(?:call|contact|connect|reach|send (?:you )?(?:the )?(?:link|setup))\b|\b(?:we will|we'll|i will|i'll)\s+(?:call|contact|connect you|reach out)\b/i;
const TEST_OR_TRAINER_MARKER = /(?:\[\s*trainer test mode\s*\]|\[\s*test mode\s*\]|active ai trainer rules|gigxomi ai trainer mode|(?:^|\n)\s*sikho\s*:)/i;
const PRODUCT_INTEREST = /\b(?:free trial|7[- ]day trial|trial setup|agency plan|workflow software|setup link|try gigxomi|use gigxomi|interested in (?:using|trying) gigxomi|how does gigxomi work|what does (?:gigxomi|this app|the app) do|what can (?:gigxomi|this app|the app) do|tell me more about (?:gigxomi|this app|the platform)|more info on (?:gigxomi|this app|the platform)|how much does gigxomi cost|pricing for (?:the )?(?:agency|software|platform))\b/i;

/**
 * Do not send an automated sales nudge into a broken, test, or human-handled chat.
 */
export function isLeadEligibleForFollowup(
  messages: readonly FollowupMessage[],
  customerName?: unknown,
): boolean {
  const customerMessages = messages.filter(isCustomerMessage);
  if (customerMessages.length === 0) return false;

  const name = String(customerName || "").trim().toLowerCase();
  const transcript = messages.map(textOf).join("\n");
  const repeatedInvalidOptions = customerMessages.filter((message) =>
    /^please select a valid option\.?$/i.test(textOf(message)),
  ).length >= 3;
  if (
    /^(?:test|trainer test|test lead|test user)$/i.test(name) ||
    TEST_OR_TRAINER_MARKER.test(transcript) ||
    repeatedInvalidOptions
  ) {
    return false;
  }

  // Any explicit request for a human is a handoff signal; never put the
  // customer back into an automated marketing sequence.
  if (customerMessages.some((message) => HUMAN_REQUEST.test(textOf(message)))) return false;

  const hasProductInterest = customerMessages.some((message) => PRODUCT_INTEREST.test(textOf(message)));
  const hasJobSearchIntent = customerMessages.some((message) => CUSTOMER_JOB_SEARCH.test(textOf(message)));
  const hasWorkflowPain = customerMessages.some((message) =>
    CUSTOMER_WORKFLOW_PAIN.test(textOf(message)) && !CUSTOMER_NO_WORKFLOW_NEED.test(textOf(message)),
  );

  const lastSupportIndex = messages.map((message) =>
    isCustomerMessage(message) && CUSTOMER_SUPPORT_ISSUE.test(textOf(message)),
  ).lastIndexOf(true);
  const lastProductInterestIndex = messages.map((message) =>
    isCustomerMessage(message) && PRODUCT_INTEREST.test(textOf(message)),
  ).lastIndexOf(true);
  if (lastSupportIndex >= 0 && lastSupportIndex > lastProductInterestIndex) return false;

  const lastNoNeedIndex = messages.map((message) =>
    isCustomerMessage(message) && CUSTOMER_NO_WORKFLOW_NEED.test(textOf(message)),
  ).lastIndexOf(true);
  if (lastNoNeedIndex >= 0 && lastNoNeedIndex > lastProductInterestIndex) return false;

  // Job/project seekers stay in the audience pool. A workflow keyword can be
  // incidental to their hiring request, so only their own product interest
  // makes a sales drip relevant.
  if (hasJobSearchIntent && !hasProductInterest) return false;

  // A sales rep has already promised a human action. Let that action happen
  // instead of stacking an automated prompt on top of it.
  const lastHandoffIndex = messages.map((message) =>
    isOutboundMessage(message) && HANDOFF_COMMITMENT.test(textOf(message)),
  ).lastIndexOf(true);
  const hasProductInterestAfterHandoff = lastHandoffIndex >= 0 && messages.some((message, index) =>
    index > lastHandoffIndex && isCustomerMessage(message) && PRODUCT_INTEREST.test(textOf(message)),
  );
  const hasPendingHandoff = lastHandoffIndex >= 0 && !hasProductInterestAfterHandoff;
  if (hasPendingHandoff) return false;

  return hasProductInterest || hasWorkflowPain;
}

export function getRecentWorkflowContextHint(messages: readonly FollowupMessage[]): string | null {
  const recentCustomerText = messages
    .filter(isCustomerMessage)
    .slice(-4)
    .map(textOf)
    .join(" ")
    .toLowerCase();

  if (/whatsapp|instagram|alag alag|separate chats|scattered/.test(recentCustomerText)) {
    return "aapne WhatsApp/Instagram chats ka zikr kiya tha";
  }
  if (/revision|brief|deadline|track|miss/.test(recentCustomerText)) {
    return "aapne briefs, revisions ya deadlines track karne ka zikr kiya tha";
  }
  if (/team|editor|assign|capacity|workload|outsource/.test(recentCustomerText)) {
    return "aapne editor/team workflow ka zikr kiya tha";
  }
  if (/free trial|7[- ]day trial|how do i join|how can i join|setup/.test(recentCustomerText)) {
    return "aapne Gigxomi explore karne ke baare mein poocha tha";
  }
  return null;
}
