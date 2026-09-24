type CustomerMessage = {
  role?: unknown;
  senderRole?: unknown;
  createdAt?: unknown;
  body?: unknown;
  content?: unknown;
};

const CLEAR_DECLINE_PATTERNS = [
  /\b(?:no thanks|no thank you|not interested|i am not interested|i'm not interested|i changed my mind|i'll pass|i will pass|not going ahead|won't proceed|will not proceed|no need|not now|maybe later)\b/i,
  /\b(?:i\s+)?(?:don't|do not|dont)\s+(?:wanna|want(?:\s+to)?)\s+(?:do\s+(?:it|this)|continue|proceed|join|try|use|sign\s*up|move\s+forward|go\s+ahead)(?:\s+(?:anymore|any\s+more|at\s+all))?\b/i,
  /\b(?:don't|do not|dont|not interested in|no need for)\b.{0,40}\b(?:gigxomi|trial|setup|platform|software|subscription)\b/i,
  /\b(?:don't|do not|dont)\s+(?:contact|message|text)\s+me\b/i,
  /\b(?:remove|unsubscribe)\s+me\b/i,
  /\b(?:mujhe|main|mai)\s+(?:ab(?:hi)?\s+)?(?:nahi|nahin|nhi)\s+(?:karna|chahiye|lena|join\s+karna)\b/i,
  /\b(?:interest(?:ed)?\s+nahi|nahi\s+interested|no\s+interest)\b/i,
  /\b(?:message|msg|text)\s+mat\s+karo\b/i,
];

const SHORT_NEGATIVE = /^(?:no|nope|nah|nahi|nahin|nhi|abhi nahi|abhi nahin)[.!\s]*$/i;
const SALES_OFFER_QUESTION = /\b(?:interested|try|test|trial|demo|walkthrough|setup|sign\s*up|register|join|book|schedule|call|connect|start|link|free)\b/i;
const EXPLICIT_PRODUCT_INTEREST = [
  /\b(?:i am|i'm|im) interested in\b.{0,50}\b(?:gigxomi|trial|setup|platform|software)\b/i,
  /\b(?:i want to|i'd like to|i would like to|let's|lets)\s+(?:try|start|use|join|register|sign\s*up)\b/i,
  /\b(?:can|could|would) you\s+(?:please\s+)?(?:send|share)\b.{0,50}\b(?:trial|link|setup|signup|sign\s*up|demo|walkthrough)\b/i,
  /\b(?:free trial|7[- ]day trial|trial setup|how do i join|how can i join|how to sign ?up|how to register|sign me up)\b/i,
  /\b(?:tell me more|more information|more info|how does gigxomi work|what does (?:gigxomi|this app|the app) do)\b/i,
];

function messageText(message: CustomerMessage): string {
  return String(message.body ?? message.content ?? "").trim();
}

function isCustomerMessage(message: CustomerMessage): boolean {
  const role = String(message.role || "").toLowerCase();
  const senderRole = String(message.senderRole || "").toLowerCase();
  return role === "customer" || role === "user" || senderRole === "customer" || senderRole === "user";
}

function isSalesAgentMessage(message: CustomerMessage): boolean {
  const role = String(message.role || "").toLowerCase();
  const senderRole = String(message.senderRole || "").toLowerCase();
  return [role, senderRole].some((value) => ["assistant", "admin", "agent", "sales"].includes(value));
}

export function isClearLeadDecline(text: string): boolean {
  const normalized = String(text || "")
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return CLEAR_DECLINE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isExplicitProductInterest(text: string): boolean {
  const normalized = String(text || "")
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (isClearLeadDecline(normalized)) return false;
  return EXPLICIT_PRODUCT_INTEREST.some((pattern) => pattern.test(normalized));
}

export function hasCustomerDeclinedSales(messages: readonly CustomerMessage[]): boolean {
  // Keep a refusal in force through unrelated replies and bot questions. Only
  // the customer explicitly asking to try/join/restart Gigxomi reopens sales.
  let declined = false;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isCustomerMessage(message)) continue;

    const text = messageText(message);
    if (isClearLeadDecline(text)) {
      declined = true;
      continue;
    }

    if (SHORT_NEGATIVE.test(text)) {
      // A bare "No" only means a sales decline when it answers an offer. For
      // example, "solo or team?" should not stop follow-ups.
      for (let prior = index - 1; prior >= 0; prior -= 1) {
        if (!isSalesAgentMessage(messages[prior])) continue;
        if (SALES_OFFER_QUESTION.test(messageText(messages[prior]))) declined = true;
        break;
      }
      continue;
    }

    if (declined && isExplicitProductInterest(text)) {
      declined = false;
    } else if (declined && SHORT_NEGATIVE.test(text)) {
      declined = true;
    } else if (declined) {
      // A later answer to a profile/support question is not consent to resume
      // the sales sequence.
      continue;
    }
  }

  return declined;
}
