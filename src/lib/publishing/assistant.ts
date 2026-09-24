import "server-only";

import type { DummyConversationView, DummyService } from "@/lib/gigxomi/dummy-platform-store";
import type {
  PortfolioAssistantDraft,
  PortfolioSourcePlatform,
  PublishingDraftRecord,
  PublishingFieldKey,
  PublishingMode,
  PublishingSuggestionPayload,
  PublishingValidation,
  ServiceAssistantDraft,
} from "@/lib/publishing/types";

const SERVICE_STEPS: PublishingFieldKey[] = [
  "category",
  "title",
  "sampleVideoUrl",
  "summary",
  "specialty",
  "targetAudience",
  "basePrice",
  "deliveryTime",
  "revisions",
  "description",
  "deliverables",
  "tags",
  "seoTitle",
  "seoDescription",
  "seoKeywords",
  "faq",
];

const PORTFOLIO_STEPS: PublishingFieldKey[] = [
  "workScope",
  "conversationId",
  "sourceUrl",
  "title",
  "category",
  "summary",
  "description",
  "price",
  "deliveryTime",
  "tags",
  "seoTitle",
  "seoDescription",
  "showcasePlacement",
];

type ModelRequestBody = {
  input?: Array<{
    role: string;
    content: string;
  }>;
  [key: string]: unknown;
};

function asModelTextPayload(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  for (const key of ["output_text", "text", "generated", "result"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return JSON.stringify(value);
}

function buildModelPromptText(openaiBody: ModelRequestBody) {
  const input = Array.isArray(openaiBody.input) ? openaiBody.input : [];
  return input.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n") + "\n\nReturn only JSON matching the schema.";
}

function nextId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
}

function detectPortfolioPlatform(urlValue: string): PublishingValidation {
  const trimmed = urlValue.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: "Paste a public video URL so Gigxomi can build the portfolio card.",
      platform: "UNKNOWN",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      message: "That link is not a valid public URL yet. Paste the direct public video link.",
      platform: "UNKNOWN",
    };
  }

  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathname = parsed.pathname;

  if (hostname.includes("drive.google.com") && pathname.includes("/folders/")) {
    return {
      ok: false,
      message: "Google Drive folder links do not work here. Paste the public video URL instead of the folder link.",
      platform: "UNSUPPORTED",
    };
  }

  if (hostname.includes("canva.com")) {
    return {
      ok: false,
      message: "Canva editor links are private design links. Export or publish the video first, then paste the public video URL.",
      platform: "UNSUPPORTED",
    };
  }

  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
    const pathParts = pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    const videoId = hostname.includes("youtu.be")
      ? pathParts[0] ?? ""
      : parsed.searchParams.get("v") ??
        (pathParts[0] === "shorts" ? pathParts[1] ?? "" : pathParts.at(-1) ?? "");

    return {
      ok: Boolean(videoId),
      message: videoId ? "YouTube video link looks good." : "Paste the direct YouTube watch or Shorts link, not the channel or homepage.",
      normalizedUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : trimmed,
      embedUrl: videoId ? `https://www.youtube.com/embed/${videoId}` : "",
      platform: "YOUTUBE",
    };
  }

  if (hostname.includes("instagram.com")) {
    const isMediaPath = /^\/(reel|p)\//.test(pathname);
    return {
      ok: isMediaPath,
      message: isMediaPath ? "Instagram reel/post link looks good." : "Paste the direct Instagram reel or post URL, not the profile home page.",
      normalizedUrl: trimmed,
      embedUrl: trimmed,
      platform: isMediaPath ? "INSTAGRAM" : "UNSUPPORTED",
    };
  }

  if (hostname.includes("vimeo.com")) {
    return {
      ok: /^\/\d+/.test(pathname),
      message: /^\/\d+/.test(pathname) ? "Vimeo video link looks good." : "Paste the direct Vimeo video URL, not the profile or collection page.",
      normalizedUrl: trimmed,
      embedUrl: trimmed,
      platform: /^\/\d+/.test(pathname) ? "VIMEO" : "UNSUPPORTED",
    };
  }

  if (hostname.includes("pinterest.com") || hostname.includes("pin.it")) {
    const looksLikePin = pathname.includes("/pin/") || hostname.includes("pin.it");
    return {
      ok: looksLikePin,
      message: looksLikePin ? "Pinterest pin link looks good." : "Paste the direct Pinterest pin URL, not the board or profile URL.",
      normalizedUrl: trimmed,
      embedUrl: trimmed,
      platform: looksLikePin ? "PINTEREST" : "UNSUPPORTED",
    };
  }

  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    return {
      ok: true,
      message: "Generic public video link accepted. Double-check the final playback preview.",
      normalizedUrl: trimmed,
      embedUrl: trimmed,
      platform: "OTHER",
    };
  }

  return {
    ok: false,
    message: "Paste a public web URL from a supported video platform.",
    platform: "UNSUPPORTED",
  };
}

function detectServiceVideoUrl(urlValue: string): PublishingValidation {
  return detectPortfolioPlatform(urlValue);
}

function getDraftValue(record: PublishingDraftRecord, fieldKey: PublishingFieldKey) {
  if (record.mode === "service") {
    return record.payload.service[fieldKey as keyof ServiceAssistantDraft];
  }

  return record.payload.portfolio[fieldKey as keyof PortfolioAssistantDraft];
}

export function getStepOrder(mode: PublishingMode) {
  return mode === "service" ? SERVICE_STEPS : PORTFOLIO_STEPS;
}

export function getMissingFields(record: PublishingDraftRecord) {
  const fields = getStepOrder(record.mode);
  return fields.filter((field) => {
    if (field === "conversationId" && record.payload.portfolio.workScope === "SELF_SAMPLE") {
      return false;
    }

    const value = getDraftValue(record, field);
    if (typeof value === "string") {
      return !value.trim();
    }

    return !value;
  });
}

export function getNextStep(record: PublishingDraftRecord) {
  const [missingField] = getMissingFields(record);
  return missingField ?? null;
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferEditTarget(record: PublishingDraftRecord, reply: string): PublishingFieldKey | null {
  const normalized = reply.toLowerCase().trim();
  if (!normalized) {
    return null;
  }

  const wantsEdit = /\b(change|edit|update|fix|modify|correct|rewrite)\b/.test(normalized);
  if (!wantsEdit) {
    return null;
  }

  const serviceMap: Array<{ field: PublishingFieldKey; patterns: RegExp[] }> = [
    { field: "sampleVideoUrl", patterns: [/\bvideo\b/, /\burl\b/, /\blink\b/, /\byoutube\b/, /\bdrive\b/, /\breel\b/, /\bvimeo\b/] },
    { field: "basePrice", patterns: [/\bprice\b/, /\brate\b/, /\bcost\b/, /\bbudget\b/] },
    { field: "deliveryTime", patterns: [/\bdelivery\b/, /\bturnaround\b/, /\btime\b/] },
    { field: "title", patterns: [/\btitle\b/, /\bheadline\b/, /\bname\b/] },
    { field: "summary", patterns: [/\bsummary\b/, /\bsubtitle\b/, /\bone liner\b/, /\btagline\b/] },
    { field: "description", patterns: [/\bdescription\b/, /\bdetails\b/, /\bprocess\b/] },
    { field: "tags", patterns: [/\btag\b/, /\bkeyword\b/, /\bsearch\b/] },
    { field: "specialty", patterns: [/\bspecialty\b/, /\bniche\b/, /\blane\b/] },
    { field: "targetAudience", patterns: [/\baudience\b/, /\bbuyer\b/, /\bfor who\b/, /\bclient\b/] },
    { field: "deliverables", patterns: [/\bdeliverable\b/, /\binclude\b/, /\bincluded\b/] },
    { field: "revisions", patterns: [/\brevision\b/] },
    { field: "seoTitle", patterns: [/\bpage title\b/, /\bseo title\b/] },
    { field: "seoDescription", patterns: [/\bseo description\b/, /\bmeta description\b/] },
    { field: "seoKeywords", patterns: [/\bseo keyword\b/] },
  ];

  const portfolioMap: Array<{ field: PublishingFieldKey; patterns: RegExp[] }> = [
    { field: "sourceUrl", patterns: [/\bvideo\b/, /\burl\b/, /\blink\b/, /\byoutube\b/, /\bdrive\b/] },
    { field: "price", patterns: [/\bprice\b/, /\brate\b/, /\bcost\b/] },
    { field: "deliveryTime", patterns: [/\bdelivery\b/, /\bturnaround\b/, /\btime\b/] },
    { field: "title", patterns: [/\btitle\b/, /\bheadline\b/, /\bname\b/] },
    { field: "summary", patterns: [/\bsummary\b/, /\bone liner\b/, /\btagline\b/] },
    { field: "description", patterns: [/\bdescription\b/, /\bdetails\b/] },
    { field: "tags", patterns: [/\btag\b/, /\bkeyword\b/, /\bsearch\b/] },
  ];

  const fieldMap = record.mode === "service" ? serviceMap : portfolioMap;
  const match = fieldMap.find((item) => item.patterns.some((pattern) => pattern.test(normalized)));
  return match?.field ?? null;
}

async function callModelRequest(openaiBody: ModelRequestBody, promptText?: string) {
  const ollamaModel = process.env.OLLAMA_MODEL?.trim();
  if (ollamaModel) {
    const ollamaUrl = process.env.OLLAMA_URL?.trim() || "http://localhost:11434";
    try {
      const resp = await fetch(`${ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: ollamaModel, prompt: promptText ?? JSON.stringify(openaiBody) }),
      });

      if (!resp.ok) return null;
      const data = (await resp.json()) as unknown;
      // Try common response shapes from various Ollama/local LLM wrappers
      // Prefer a plain text payload when available.
      return asModelTextPayload(data);
    } catch {
      return null;
    }
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openaiBody),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as unknown;
    return asModelTextPayload(payload);
  } catch {
    return null;
  }
}

async function getOpenAIConversationReply(record: PublishingDraftRecord, userReply: string, focus: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  try {
    const openaiBody = {
      model: process.env.OPENAI_PUBLISHING_MODEL?.trim() || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are Gigxomi's publishing copilot. The freelancer may ask to edit a field, ask a product question, or ask for guidance after the draft is complete. Return strict JSON with keys assistantMessage, fieldSuggestions, marketHints. assistantMessage should directly answer the user and guide the next action. fieldSuggestions should be 0-3 short click-ready options. marketHints should be 0-3 short helpful notes.",
        },
        {
          role: "user",
          content: `Focus: ${focus}\nUser message: ${userReply}\nCurrent draft: ${JSON.stringify(record.payload)}\nRecent chat:\n${record.rawMessages
            .slice(-8)
            .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
            .join("\n")}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "publishing_followup",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              assistantMessage: { type: "string" },
              fieldSuggestions: { type: "array", items: { type: "string" } },
              marketHints: { type: "array", items: { type: "string" } },
            },
            required: ["assistantMessage", "fieldSuggestions", "marketHints"],
          },
        },
      },
    };

    const promptText = buildModelPromptText(openaiBody);
    const result = await callModelRequest(openaiBody, promptText);
    if (!result) return null;
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return text ? (JSON.parse(text) as { assistantMessage: string; fieldSuggestions: string[]; marketHints: string[] }) : null;
  } catch {
    return null;
  }
}

function normalizeReplyForField(field: PublishingFieldKey, reply: string, record: PublishingDraftRecord, conversations: DummyConversationView[]) {
  const trimmed = reply.trim();
  const patch: Partial<ServiceAssistantDraft & PortfolioAssistantDraft> = {};
  let validation: PublishingValidation | null = null;

  switch (field) {
    case "category":
      patch.category = /design/i.test(trimmed) ? "Graphic Design" : "Video Editing";
      break;
    case "basePrice":
    case "price":
      patch[field] = trimmed.replace(/[^\d]/g, "");
      break;
    case "tags":
    case "seoKeywords":
      patch[field] = splitCsv(trimmed).join(", ");
      break;
    case "faq":
      patch.faq = trimmed.includes("|") ? trimmed : `${trimmed} | Add the answer here.`;
      break;
    case "workScope":
      patch.workScope = /client|agency|project/i.test(trimmed) ? "CLIENT_WORK" : "SELF_SAMPLE";
      break;
    case "conversationId": {
      const match =
        conversations.find((conversation) => conversation.id === trimmed) ??
        conversations.find((conversation) =>
          `${conversation.customerDisplayName} ${conversation.serviceTitle}`.toLowerCase().includes(trimmed.toLowerCase()),
        ) ??
        conversations[0];
      patch.conversationId = match?.id ?? "";
      break;
    }
    case "showcasePlacement":
      if (/agency/i.test(trimmed)) {
        patch.showcasePlacement = "AGENCY_SHOWCASE";
      } else if (/public/i.test(trimmed)) {
        patch.showcasePlacement = "PUBLIC_SERVICE";
      } else if (/private/i.test(trimmed)) {
        patch.showcasePlacement = "PRIVATE_ONLY";
      } else {
        patch.showcasePlacement = "FREELANCER_PROFILE";
      }
      break;
    case "sourceUrl":
      validation = detectPortfolioPlatform(trimmed);
      patch.sourceUrl = validation.normalizedUrl ?? trimmed;
      patch.sourcePlatform = (validation.platform ?? "UNKNOWN") as PortfolioSourcePlatform;
      patch.sourceEmbedUrl = validation.embedUrl ?? "";
      break;
    case "sampleVideoUrl":
      validation = detectServiceVideoUrl(trimmed);
      patch.sampleVideoUrl = validation.normalizedUrl ?? trimmed;
      patch.sampleVideoEmbedUrl = validation.embedUrl ?? trimmed;
      break;
    default:
      patch[field] = trimmed;
  }

  const nextRecord =
    record.mode === "service"
      ? {
          ...record,
          payload: {
            ...record.payload,
            service: {
              ...record.payload.service,
              ...patch,
            },
          },
        }
      : {
          ...record,
          payload: {
            ...record.payload,
            portfolio: {
              ...record.payload.portfolio,
              ...patch,
            },
          },
        };

  if (record.mode === "service") {
    const serviceDraft = nextRecord.payload.service;
    if (!serviceDraft.seoTitle.trim() && (field === "title" || field === "summary")) {
      serviceDraft.seoTitle = serviceDraft.title.trim() || serviceDraft.summary.trim();
    }
    if (!serviceDraft.seoDescription.trim() && (field === "summary" || field === "description")) {
      serviceDraft.seoDescription = serviceDraft.summary.trim() || serviceDraft.description.trim();
    }
  } else {
    const portfolioDraft = nextRecord.payload.portfolio;
    if (!portfolioDraft.seoTitle.trim() && field === "title") {
      portfolioDraft.seoTitle = portfolioDraft.title.trim();
    }
    if (!portfolioDraft.seoDescription.trim() && (field === "summary" || field === "description")) {
      portfolioDraft.seoDescription = portfolioDraft.summary.trim() || portfolioDraft.description.trim();
    }
  }

  return {
    record: nextRecord,
    validation,
  };
}

function buildServiceHints(record: PublishingDraftRecord, allServices: DummyService[]) {
  const draft = record.payload.service;
  const relevant = allServices.filter((service) => service.category === draft.category);
  const prices = relevant.map((service) => service.basePrice).filter((value) => Number.isFinite(value) && value > 0);
  const averagePrice = median(prices);
  const commonDeliveries = [...new Set(relevant.map((service) => service.deliveryTime).filter(Boolean))].slice(0, 3);
  const frequentTags = [...new Set(relevant.flatMap((service) => service.tags).filter(Boolean))].slice(0, 4);

  return {
    fieldSuggestions:
      record.currentStep === "title"
        ? [
            `${draft.category === "Video Editing" ? "Short form editor" : "Thumbnail designer"} for ${draft.targetAudience || "creators"}`,
            `${titleCase(draft.specialty || draft.category)} with ${draft.deliveryTime || "fast"} delivery`,
            `Premium ${draft.category === "Video Editing" ? "video edit" : "design pack"} for ${draft.targetAudience || "brands"}`,
          ]
        : record.currentStep === "basePrice"
          ? [
              averagePrice ? `INR ${averagePrice}` : "INR 1500",
              averagePrice ? `INR ${averagePrice + 800}` : "INR 2500",
              averagePrice ? `INR ${Math.max(500, averagePrice - 600)}` : "INR 900",
            ]
          : record.currentStep === "sampleVideoUrl"
            ? ["Paste a YouTube watch link", "Paste an Instagram reel URL", "Paste a Vimeo video URL"]
          : record.currentStep === "deliveryTime"
            ? commonDeliveries.length
              ? commonDeliveries
              : ["1 Day", "2 Days", "3 Days"]
            : record.currentStep === "tags"
              ? frequentTags.length
                ? frequentTags
                : ["short form", "reels", "youtube", "branding"]
              : [],
    marketHints: [
      prices.length ? `Similar ${draft.category.toLowerCase()} services are centered around INR ${averagePrice.toLocaleString("en-IN")}.` : "You are early in this category, so lead with clarity and outcome.",
      commonDeliveries.length ? `Fastest common turnaround in this lane: ${commonDeliveries.join(", ")}.` : "Quick turnaround performs well when the scope is very clear.",
      frequentTags.length ? `Common keywords buyers already see here: ${frequentTags.join(", ")}.` : "Use buyer language that matches the outcome, not only the tool names.",
    ],
  };
}

function buildPortfolioHints(record: PublishingDraftRecord, conversations: DummyConversationView[]) {
  const draft = record.payload.portfolio;
  const conversation = conversations.find((item) => item.id === draft.conversationId);
  const fieldSuggestions =
    record.currentStep === "showcasePlacement"
      ? ["FREELANCER_PROFILE", "PUBLIC_SERVICE", "AGENCY_SHOWCASE"]
      : record.currentStep === "sourceUrl"
        ? ["YouTube watch URL", "Instagram reel URL", "Vimeo video URL"]
        : record.currentStep === "price"
          ? ["INR 2500", "INR 4500", "INR 6500"]
          : [];

  return {
    fieldSuggestions,
    marketHints: [
      draft.workScope === "CLIENT_WORK" ? "Client showcase stays private until admin or manager approval." : "Self portfolio can go live as soon as the metadata and source link are ready.",
      conversation ? `Selected conversation: ${conversation.customerDisplayName} for ${conversation.serviceTitle}.` : "Select a client conversation only if this is real client work.",
      draft.sourcePlatform && draft.sourcePlatform !== "UNKNOWN" ? `Detected source platform: ${draft.sourcePlatform}.` : "Paste the direct public video URL so the player preview stays stable.",
    ],
  };
}

async function getOpenAISuggestion(record: PublishingDraftRecord, fieldKey: PublishingFieldKey) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const modeLabel = record.mode === "service" ? "service listing" : "portfolio showcase";
  const currentDraft = JSON.stringify(record.payload);
  const recentMessages = record.rawMessages
    .slice(-6)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
  const missingFields = getMissingFields(record).slice(0, 6).join(", ");
  const currentFieldValue = getDraftValue(record, fieldKey);

  try {
    const openaiBody = {
      model: process.env.OPENAI_PUBLISHING_MODEL?.trim() || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are Gigxomi's service-listing copilot for freelancers. Your job is to ask one focused question at a time, help the freelancer write a stronger listing, and keep the listing discoverable across classic search, ChatGPT answers, Gemini answers, and Gigxomi marketplace search. Read the full draft context and recent chat before responding. Prefer buyer language, strong outcomes, clear niche positioning, and natural keyword coverage. Do not sound robotic or generic. Return strict JSON with keys assistantMessage, fieldSuggestions, marketHints. assistantMessage must be a short conversational question or guidance line. fieldSuggestions must be an array of max 3 short click-ready answer options. marketHints must be an array of max 3 short insights. Avoid mentioning SEO explicitly unless the current field is seoTitle, seoDescription, or seoKeywords. If the current answer is weak, help the freelancer improve it instead of just moving on.",
        },
        {
          role: "user",
          content: `Mode: ${modeLabel}\nCurrent step: ${fieldKey}\nCurrent field value: ${typeof currentFieldValue === "string" ? currentFieldValue : JSON.stringify(currentFieldValue)}\nMissing fields: ${missingFields}\nRecent chat:\n${recentMessages || "No prior messages."}\n\nDraft JSON:\n${currentDraft}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "publishing_suggestions",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              assistantMessage: { type: "string" },
              fieldSuggestions: {
                type: "array",
                items: { type: "string" },
              },
              marketHints: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["assistantMessage", "fieldSuggestions", "marketHints"],
          },
        },
      },
    };

    const promptText = buildModelPromptText(openaiBody);
    const result = await callModelRequest(openaiBody, promptText);
    if (!result) return null;
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return text ? (JSON.parse(text) as { assistantMessage: string; fieldSuggestions: string[]; marketHints: string[] }) : null;
  } catch {
    return null;
  }
}

export async function buildAssistantTurn(input: {
  record: PublishingDraftRecord;
  userReply?: string;
  fieldKey?: PublishingFieldKey;
  lockField?: boolean;
  allServices: DummyService[];
  conversations: DummyConversationView[];
}) {
  let record = input.record;
  let validation: PublishingValidation | null = null;
  let forcedPrompt: string | null = null;
  let forcedSuggestions: string[] = [];
  let forcedMarketHints: string[] = [];
  const explicitField = input.userReply && input.fieldKey ? input.fieldKey : null;

  if (input.userReply && explicitField) {
    record.currentStep = explicitField;
    const update = normalizeReplyForField(explicitField, input.userReply, record, input.conversations);
    record = update.record;
    validation = update.validation;
  } else if (input.userReply) {
    const editTarget = inferEditTarget(record, input.userReply);
    if (editTarget) {
      record.currentStep = editTarget;
      const aiFollowup = await getOpenAIConversationReply(record, input.userReply, `edit ${editTarget}`);
      forcedPrompt = aiFollowup?.assistantMessage ?? buildAssistantPrompt(record, editTarget, null);
      forcedSuggestions = aiFollowup?.fieldSuggestions ?? [];
      forcedMarketHints = aiFollowup?.marketHints ?? [];
    }
  }

  if (input.userReply && record.currentStep && !forcedPrompt && !explicitField) {
    const update = normalizeReplyForField(record.currentStep, input.userReply, record, input.conversations);
    record = update.record;
    validation = update.validation;
  }

  const missingFields = getMissingFields(record);
  const shouldStayLocked = Boolean(input.lockField && record.currentStep);
  const nextStep = forcedPrompt
    ? record.currentStep
    : shouldStayLocked
      ? record.currentStep
      : input.userReply
        ? (missingFields[0] ?? null)
        : (record.currentStep ?? missingFields[0] ?? null);
  record.currentStep = nextStep;
  record.missingFields = missingFields;
  record.status = missingFields.length ? "IN_PROGRESS" : record.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

  const fallbackPayload =
    record.mode === "service" ? buildServiceHints(record, input.allServices) : buildPortfolioHints(record, input.conversations);
  const aiPayload = nextStep && !forcedPrompt ? await getOpenAISuggestion(record, nextStep) : null;
  const fieldSuggestions = forcedSuggestions.length
    ? forcedSuggestions
    : aiPayload?.fieldSuggestions?.length
      ? aiPayload.fieldSuggestions
      : fallbackPayload.fieldSuggestions;
  const marketHints = forcedMarketHints.length
    ? forcedMarketHints
    : aiPayload?.marketHints?.length
      ? aiPayload.marketHints
      : fallbackPayload.marketHints;

  const assistantMessage = forcedPrompt ?? aiPayload?.assistantMessage ?? buildAssistantPrompt(record, nextStep, validation);

  const payload: PublishingSuggestionPayload = {
    assistantMessage,
    currentStep: record.currentStep,
    nextStep,
    draftPatch: record.payload,
    fieldSuggestions,
    marketHints,
    missingFields,
    validation,
  };

  return {
    record,
    payload,
  };
}

export function buildAssistantPrompt(record: PublishingDraftRecord, nextStep: PublishingFieldKey | null, validation: PublishingValidation | null) {
  if (validation && !validation.ok) {
    return validation.message;
  }

  if (!nextStep) {
    return record.mode === "service"
      ? "Everything important is in place. You can save this service draft or publish it now."
      : record.payload.portfolio.workScope === "CLIENT_WORK"
        ? "The portfolio draft is complete. Request approval if it is client work, or publish if approval is already done."
        : "The portfolio draft is complete. You can save it or publish it now.";
  }

  switch (nextStep) {
    case "category":
      return record.mode === "service" ? "What are you offering here: video editing or graphic design?" : "Which content lane fits this portfolio piece best?";
    case "title":
      return "What title should buyers see first?";
    case "sampleVideoUrl":
      return "Paste your best public sample video URL so buyers can watch your work.";
    case "summary":
      return "Give me one short buyer-facing summary line.";
    case "specialty":
      return "What is the specialty lane for this service?";
    case "targetAudience":
      return "Who is this best for?";
    case "basePrice":
    case "price":
      return "What starting price should Gigxomi show?";
    case "deliveryTime":
      return "What delivery time should we promise?";
    case "revisions":
      return "How many revisions are included?";
    case "description":
      return "Describe the result, process, and why your work stands out.";
    case "deliverables":
      return "List the deliverables. You can type them in one line or separated by commas.";
    case "tags":
      return "Which tags or keywords should help buyers discover this?";
    case "seoTitle":
      return "What search-friendly page title should we use?";
    case "seoDescription":
      return "What search-friendly summary should we use for this listing page?";
    case "seoKeywords":
      return "Which search keywords matter most for this listing?";
    case "faq":
      return "Add one FAQ in this format: Question | Answer.";
    case "workScope":
      return "Is this your own sample work or a real client project?";
    case "conversationId":
      return "Which client conversation does this portfolio piece belong to?";
    case "sourceUrl":
      return "Paste the direct public video URL.";
    case "showcasePlacement":
      return "Where should this show first: freelancer profile, public service, agency showcase, or private only?";
    default:
      return "Tell me the next detail and I will keep building the draft.";
  }
}

export function createAssistantMessage(content: string, fieldKey?: PublishingFieldKey) {
  return {
    id: nextId("pub-msg"),
    role: "assistant" as const,
    content,
    createdAt: new Date().toISOString(),
    fieldKey,
  };
}

export function createFreelancerMessage(content: string, fieldKey?: PublishingFieldKey) {
  return {
    id: nextId("pub-msg"),
    role: "freelancer" as const,
    content,
    createdAt: new Date().toISOString(),
    fieldKey,
  };
}
