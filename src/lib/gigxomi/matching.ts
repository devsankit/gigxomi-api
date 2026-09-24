import type {
  MatchFilters,
  MatchReason,
  MatchResponse,
  MatchedService,
  WordPressService,
} from "./types";
import { getPublicInquiryNumber } from "@/lib/gigxomi/public-contact";

const categoryKeywordMap: Record<string, string[]> = {
  "Short Form Content": [
    "short form",
    "short-form",
    "reel",
    "reels",
    "shorts",
    "instagram",
    "ugc",
    "viral",
    "ads",
    "promo",
    "promotion",
    "talking head",
  ],
  "Long Form Content": [
    "podcast",
    "youtube",
    "youtube video",
    "long form",
    "long-form",
    "long video",
    "documentary",
    "vlog",
    "storytelling",
  ],
  "Graphic Design Gallery": [
    "thumbnail",
    "graphic design",
    "poster",
    "post design",
    "banner",
    "cover",
    "design",
    "image",
  ],
};

const urgencyKeywords = ["today", "urgent", "asap", "tomorrow", "quick", "fast", "1 day", "2 days"];
const styleKeywordMap: Record<string, string[]> = {
  fitness: ["gym", "fitness", "workout", "sports"],
  beauty: ["skincare", "beauty", "cosmetic", "makeup"],
  finance: ["finance", "stock", "trading", "crypto", "investment"],
  podcast: ["podcast", "interview", "conversation"],
  ecommerce: ["ecommerce", "e-commerce", "product", "brand", "ads", "ad", "promo", "promotion"],
  storytelling: ["storytelling", "documentary", "cinematic", "vlog"],
  wedding: ["wedding", "bridal", "pre wedding", "pre-wedding", "ceremony", "couple"],
  youtube: ["youtube", "youtube video", "youtube editor", "youtube channel"],
};

export function matchServices(
  services: WordPressService[],
  prompt: string,
  filters: MatchFilters = {},
): MatchResponse {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const extractedBudget = filters.budget ?? extractBudget(normalizedPrompt);
  const extractedUrgency = filters.urgency?.trim() || extractUrgency(normalizedPrompt);
  const keywords = tokenize(normalizedPrompt);
  const detectedCategories = detectCategories(normalizedPrompt);
  const detectedStyleSignals = detectStyleSignals(normalizedPrompt);

  let ranked = services
    .map((service) =>
      scoreService(
        service,
        normalizedPrompt,
        keywords,
        detectedCategories,
        detectedStyleSignals,
        extractedBudget,
        extractedUrgency,
        filters,
      ),
    )
    .filter((service) => passesStructuredFilters(service, filters));

  let budgetMode: MatchResponse["appliedFilters"]["budgetMode"] = "not-set";

  if (typeof extractedBudget === "number") {
    const withinBudget = ranked.filter((service) => service.price !== null && service.price <= extractedBudget);

    if (withinBudget.length > 0) {
      ranked = withinBudget;
      budgetMode = "within-budget";
    } else {
      budgetMode = "closest-above-budget";
      ranked = ranked.map((service) => {
        if (service.price !== null && service.price > extractedBudget) {
          return {
            ...service,
            reasons: [
              {
                label: "Above budget",
                detail: `${service.currency} ${service.price.toLocaleString()} is above the requested budget of ${extractedBudget.toLocaleString()}.`,
              },
              ...service.reasons,
            ],
          };
        }

        return service;
      });
    }
  }

  ranked = sortServices(ranked, filters.sort);

  const results = ranked.slice(0, 8).map((item) => ({
    ...item,
    whatsappHref: buildWhatsAppHref(prompt, item),
  }));

  return {
    prompt,
    extracted: {
      budget: extractedBudget,
      urgency: extractedUrgency,
      keywords,
      categories: detectedCategories,
    },
    appliedFilters: {
      category: filters.category,
      mediaType: filters.mediaType,
      discoveryPreset: filters.discoveryPreset,
      sort: filters.sort,
      budgetMode,
    },
    results,
  };
}

function scoreService(
  service: WordPressService,
  prompt: string,
  keywords: string[],
  detectedCategories: string[],
  detectedStyleSignals: string[],
  budget: number | undefined,
  urgency: string | undefined,
  filters: MatchFilters,
): MatchedService {
  const normalizedCategory = inferPrimaryCategory(service);
  const titleText = service.service_title.toLowerCase();
  const haystack = [
    service.service_title,
    service.description,
    normalizedCategory,
    service.freelancer.full_name,
    service.freelancer.display_name,
    service.freelancer.title,
    service.freelancer.description,
  ]
    .join(" ")
    .toLowerCase();
  const serviceSignals = detectStyleSignals(haystack);

  let score = 8;
  const reasons: MatchReason[] = [];

  const matchedTitleKeywords = keywords.filter((keyword) => keyword.length > 2 && titleText.includes(keyword));
  if (matchedTitleKeywords.length > 0) {
    score += Math.min(40, matchedTitleKeywords.length * 14);
    reasons.push({
      label: "Title match",
      detail: `Matched in title: ${matchedTitleKeywords.slice(0, 3).join(", ")}`,
    });
  }

  const matchedKeywords = keywords.filter((keyword) => keyword.length > 2 && haystack.includes(keyword));
  if (matchedKeywords.length > 0) {
    score += Math.min(36, matchedKeywords.length * 6);
    reasons.push({
      label: "Intent fit",
      detail: `Matched keywords: ${matchedKeywords.slice(0, 4).join(", ")}`,
    });
  }

  if (normalizedCategory && detectedCategories.includes(normalizedCategory)) {
    score += 42;
    reasons.push({
      label: "Category match",
      detail: normalizedCategory,
    });
  } else if (detectedCategories.length > 0) {
    score -= 28;
  }

  if (filters.category && normalizedCategory === filters.category) {
    score += 18;
    reasons.push({
      label: "Filter match",
      detail: `Matches ${filters.category}`,
    });
  }

  const matchedSignals = detectedStyleSignals.filter((signal) => serviceSignals.includes(signal));
  if (matchedSignals.length > 0) {
    score += Math.min(28, matchedSignals.length * 12);
    reasons.push({
      label: "Style fit",
      detail: matchedSignals.slice(0, 2).join(", "),
    });
  } else if (detectedStyleSignals.length > 0) {
    score -= 12;
  }

  const promptLooksLikeEditorSearch =
    prompt.includes("editor") || prompt.includes("editing") || prompt.includes("video editor");
  if (promptLooksLikeEditorSearch && titleText.includes("editor")) {
    score += 12;
  }

  if (typeof budget === "number" && typeof service.price === "number") {
    if (service.price <= budget) {
      score += 20;
      reasons.push({
        label: "Budget fit",
        detail: `${service.currency} ${service.price.toLocaleString()} is within budget`,
      });
    } else if (service.price <= budget * 1.25) {
      score += 8;
      reasons.push({
        label: "Close budget fit",
        detail: `${service.currency} ${service.price.toLocaleString()} is slightly above target`,
      });
    }
  }

  if (urgency && service.delivery_time.toLowerCase().includes(extractUrgencyToken(urgency))) {
    score += 14;
    reasons.push({
      label: "Delivery fit",
      detail: `${service.delivery_time} delivery supports urgent lead routing`,
    });
  }

  if (service.video_url) {
    score += 4;
    reasons.push({
      label: "Sample ready",
      detail: "This service already includes media samples for quick review.",
    });
  }

  score += getPresetBoost(service, filters.discoveryPreset);

  const summary = buildSummary(service);

  return {
    ...service,
    normalizedCategory,
    score,
    reasons,
    summary,
    whatsappHref: "",
  };
}

function passesStructuredFilters(service: MatchedService, filters: MatchFilters) {
  const strictPresetCategory = getStrictPresetCategory(filters.discoveryPreset);
  const requestedCategory = filters.category ?? strictPresetCategory;
  if (requestedCategory && service.normalizedCategory !== requestedCategory) {
    return false;
  }
  if (filters.mediaType === "video" && !service.video_url) {
    return false;
  }
  if (filters.mediaType === "image") {
    const hasImageGallery = Array.isArray(service.gallery)
      ? service.gallery.length > 0
      : Object.keys(service.gallery ?? {}).length > 0;
    if (!hasImageGallery && !service.featured_image) {
      return false;
    }
  }
  return true;
}
function getStrictPresetCategory(preset: MatchFilters["discoveryPreset"]) {
  switch (preset) {
    case "short-form":
      return "Short Form Content";
    case "long-form":
      return "Long Form Content";
    case "graphic-design":
      return "Graphic Design Gallery";
    default:
      return undefined;
  }
}

function getPresetBoost(service: WordPressService, preset: MatchFilters["discoveryPreset"]) {
  const price = service.price ?? 0;
  const category = inferPrimaryCategory(service);
  const delivery = service.delivery_time.toLowerCase();

  switch (preset) {
    case "short-form":
      return category === "Short Form Content" ? 22 : 0;
    case "long-form":
      return category === "Long Form Content" ? 22 : 0;
    case "graphic-design":
      return category === "Graphic Design Gallery" ? 22 : 0;
    case "fast-delivery":
      return delivery.includes("1") ? 18 : delivery.includes("2") ? 10 : 0;
    case "budget-friendly":
      return price > 0 && price <= 1000 ? 18 : 0;
    case "premium-editors":
      return price >= 4000 ? 16 : 0;
    case "best-sellers":
      return service.video_url ? 14 : 8;
    default:
      return 0;
  }
}

function sortServices(services: MatchedService[], sort: MatchFilters["sort"]) {
  const next = [...services];

  if (sort === "price-low") {
    return next.sort((left, right) => {
      const scoreGap = right.score - left.score;
      if (Math.abs(scoreGap) > 18) {
        return scoreGap;
      }

      return (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER);
    });
  }

  if (sort === "delivery-fast") {
    return next.sort((left, right) => {
      const scoreGap = right.score - left.score;
      if (Math.abs(scoreGap) > 18) {
        return scoreGap;
      }

      return extractDeliveryDays(left.delivery_time) - extractDeliveryDays(right.delivery_time);
    });
  }

  return next.sort((left, right) => right.score - left.score);
}

function extractDeliveryDays(deliveryTime: string) {
  const match = deliveryTime.match(/(\d+)/);
  return match?.[1] ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function buildSummary(service: WordPressService) {
  const rawText = service.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!rawText) {
    return `${service.freelancer.full_name || service.freelancer.display_name} is available on Gigxomi for ${inferPrimaryCategory(service) || "creative"} work.`;
  }

  return rawText;
}

function buildWhatsAppHref(prompt: string, service: MatchedService) {
  const text = [
    "Hi Gigxomi,",
    `I need help with: ${prompt}`,
    `Matched service: ${service.service_title}`,
    `Editor: ${service.freelancer.full_name || service.freelancer.display_name}`,
    `Budget direction: ${service.currency} ${service.price?.toLocaleString() ?? "Discuss"}`,
    `Delivery: ${service.delivery_time || "Discuss"}`,
    `Service URL: ${service.service_url}`,
  ].join("\n");

  return `https://wa.me/${getPublicInquiryNumber()}?text=${encodeURIComponent(text)}`;
}

function extractBudget(prompt: string) {
  const matches = prompt.match(/(?:rs|inr|rupees?)?\s?(\d{3,6})/i);
  if (!matches?.[1]) {
    return undefined;
  }

  return Number(matches[1]);
}

function extractUrgency(prompt: string) {
  return urgencyKeywords.find((item) => prompt.includes(item));
}

function extractUrgencyToken(urgency: string) {
  if (urgency.includes("1")) {
    return "1";
  }

  if (urgency.includes("2")) {
    return "2";
  }

  if (urgency.includes("today")) {
    return "day";
  }

  return urgency.toLowerCase();
}

function detectCategories(prompt: string) {
  return Object.entries(categoryKeywordMap)
    .filter(([, keywords]) => keywords.some((keyword) => prompt.includes(keyword)))
    .map(([category]) => category);
}

function detectStyleSignals(text: string) {
  return Object.entries(styleKeywordMap)
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
    .map(([signal]) => signal);
}

function tokenize(prompt: string) {
  return Array.from(new Set(prompt.split(/[^a-z0-9]+/i).filter(Boolean)));
}

function normalizeCategory(category: string | string[]) {
  if (Array.isArray(category)) {
    return category.join(", ");
  }

  return category || "";
}

function inferPrimaryCategory(service: WordPressService) {
  const normalized = normalizeCategory(service.category);
  if (normalized) {
    return normalized;
  }

  const haystack = `${service.service_title} ${service.description}`.toLowerCase();
  const detected = detectCategories(haystack);
  return detected[0] ?? "Creative service";
}
