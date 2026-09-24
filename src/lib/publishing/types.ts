export type PublishingMode = "service" | "portfolio";

export type PublishingDraftStatus =
  | "IN_PROGRESS"
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "PUBLISHED";

export type PublishingAssistantRole = "assistant" | "freelancer" | "system";

export type PublishingFieldKey =
  | "category"
  | "title"
  | "sampleVideoUrl"
  | "summary"
  | "specialty"
  | "targetAudience"
  | "basePrice"
  | "deliveryTime"
  | "revisions"
  | "description"
  | "deliverables"
  | "tags"
  | "price"
  | "seoTitle"
  | "seoDescription"
  | "seoKeywords"
  | "faq"
  | "workScope"
  | "conversationId"
  | "sourceUrl"
  | "showcasePlacement";

export const ALL_PUBLISHING_FIELD_KEYS: PublishingFieldKey[] = [
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
  "price",
  "seoTitle",
  "seoDescription",
  "seoKeywords",
  "faq",
  "workScope",
  "conversationId",
  "sourceUrl",
  "showcasePlacement",
];

export type PublishingMessage = {
  id: string;
  role: PublishingAssistantRole;
  content: string;
  createdAt: string;
  fieldKey?: PublishingFieldKey;
};

export type ServiceAssistantDraft = {
  title: string;
  sampleVideoUrl: string;
  sampleVideoEmbedUrl: string;
  summary: string;
  category: "Video Editing" | "Graphic Design";
  specialty: string;
  description: string;
  targetAudience: string;
  deliveryTime: string;
  revisions: string;
  basePrice: string;
  tags: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  deliverables: string;
  faq: string;
};

export type PortfolioWorkScope = "SELF_SAMPLE" | "CLIENT_WORK";
export type PortfolioSourcePlatform = "YOUTUBE" | "INSTAGRAM" | "VIMEO" | "PINTEREST" | "OTHER" | "UNSUPPORTED" | "UNKNOWN";

export type PortfolioAssistantDraft = {
  workScope: PortfolioWorkScope;
  conversationId: string;
  title: string;
  category: string;
  summary: string;
  description: string;
  deliveryTime: string;
  price: string;
  tags: string;
  seoTitle: string;
  seoDescription: string;
  sourceUrl: string;
  sourcePlatform: PortfolioSourcePlatform;
  sourceEmbedUrl: string;
  showcasePlacement: "PRIVATE_ONLY" | "FREELANCER_PROFILE" | "PUBLIC_SERVICE" | "AGENCY_SHOWCASE";
};

export type PublishingStructuredDraft = {
  service: ServiceAssistantDraft;
  portfolio: PortfolioAssistantDraft;
};

export type PublishingDraftRecord = {
  id: string;
  ownerId: string;
  ownerDisplayName: string;
  mode: PublishingMode;
  status: PublishingDraftStatus;
  linkedEntityId: string | null;
  currentStep: PublishingFieldKey | null;
  missingFields: PublishingFieldKey[];
  payload: PublishingStructuredDraft;
  rawMessages: PublishingMessage[];
  lastSuggestedValues: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
};

export type PublishingValidation = {
  ok: boolean;
  message: string;
  normalizedUrl?: string;
  platform?: PortfolioSourcePlatform;
  embedUrl?: string;
};

export type PublishingSuggestionPayload = {
  assistantMessage: string;
  currentStep: PublishingFieldKey | null;
  nextStep: PublishingFieldKey | null;
  draftPatch: Partial<PublishingStructuredDraft>;
  fieldSuggestions: string[];
  marketHints: string[];
  missingFields: PublishingFieldKey[];
  validation: PublishingValidation | null;
};

export const defaultServiceAssistantDraft: ServiceAssistantDraft = {
  title: "",
  sampleVideoUrl: "",
  sampleVideoEmbedUrl: "",
  summary: "",
  category: "Video Editing",
  specialty: "",
  description: "",
  targetAudience: "",
  deliveryTime: "2 Days",
  revisions: "2 revisions included",
  basePrice: "",
  tags: "",
  seoTitle: "",
  seoDescription: "",
  seoKeywords: "",
  deliverables: "",
  faq: "What is included in the base price? | Core delivery is included as listed above.",
};

export const defaultPortfolioAssistantDraft: PortfolioAssistantDraft = {
  workScope: "SELF_SAMPLE",
  conversationId: "",
  title: "",
  category: "Video Editing",
  summary: "",
  description: "",
  deliveryTime: "",
  price: "",
  tags: "",
  seoTitle: "",
  seoDescription: "",
  sourceUrl: "",
  sourcePlatform: "UNKNOWN",
  sourceEmbedUrl: "",
  showcasePlacement: "FREELANCER_PROFILE",
};

export const defaultPublishingStructuredDraft: PublishingStructuredDraft = {
  service: defaultServiceAssistantDraft,
  portfolio: defaultPortfolioAssistantDraft,
};
