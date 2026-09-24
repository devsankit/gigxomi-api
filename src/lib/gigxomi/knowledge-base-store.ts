import "server-only";

import { randomUUID } from "node:crypto";
import { Socket } from "node:net";

import { createManualConversationFromFile, deliverConversationMessageFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { prisma } from "@/lib/prisma";
import { buildSiteUrl, companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";

export type KnowledgeBaseRole = "FREELANCER" | "AGENCY" | "PLATFORM";
export type KnowledgeBaseArticleStatus = "DRAFT" | "PUBLISHED";
export type KnowledgeBaseMediaKind = "IMAGE" | "VIDEO" | "SCREENSHOT" | "ILLUSTRATION";

export type KnowledgeBaseBlock = {
  body: string;
  title: string;
};

export type KnowledgeBaseStep = {
  body: string;
  title: string;
};

export type KnowledgeBaseFaq = {
  answer: string;
  question: string;
};

export type KnowledgeBaseCategory = {
  id: string;
  role: KnowledgeBaseRole;
  slug: string;
  title: string;
  description: string;
  iconKey: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBaseMedia = {
  id: string;
  kind: KnowledgeBaseMediaKind;
  title: string;
  alt: string;
  url: string;
  mobileUrl: string | null;
  thumbnailUrl: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBaseArticle = {
  id: string;
  role: KnowledgeBaseRole;
  categoryId: string | null;
  category?: KnowledgeBaseCategory | null;
  slug: string;
  href: string;
  title: string;
  summary: string;
  intro: string;
  bodyBlocks: KnowledgeBaseBlock[];
  steps: KnowledgeBaseStep[];
  importantNotes: string[];
  faqs: KnowledgeBaseFaq[];
  relatedSlugs: string[];
  tags: string[];
  filterGroups: string[];
  mediaIds: string[];
  media: KnowledgeBaseMedia[];
  videoUrl: string | null;
  videoTitle: string | null;
  seoTitle: string;
  seoDescription: string;
  readingMinutes: number;
  status: KnowledgeBaseArticleStatus;
  botTrainingEnabled: boolean;
  popular: boolean;
  topSearched: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBaseSearchResult = {
  article: KnowledgeBaseArticle;
  score: number;
  matchedTerms: string[];
};

export type KnowledgeBaseHomeData = {
  articles: KnowledgeBaseArticle[];
  categories: KnowledgeBaseCategory[];
  media: KnowledgeBaseMedia[];
  popularArticles: KnowledgeBaseArticle[];
  recentlyUpdated: KnowledgeBaseArticle[];
  topSearched: KnowledgeBaseArticle[];
};

type CategoryRow = {
  id: string;
  role: KnowledgeBaseRole;
  slug: string;
  title: string;
  description: string;
  iconKey: string;
  sortOrder: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type MediaRow = {
  id: string;
  kind: KnowledgeBaseMediaKind;
  title: string;
  alt: string;
  url: string;
  mobileUrl: string | null;
  thumbnailUrl: string | null;
  sortOrder: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ArticleRow = {
  id: string;
  role: KnowledgeBaseRole;
  categoryId: string | null;
  slug: string;
  title: string;
  summary: string;
  intro: string;
  bodyBlocks: unknown;
  steps: unknown;
  importantNotes: string[] | null;
  faqs: unknown;
  relatedSlugs: string[] | null;
  tags: string[] | null;
  filterGroups: string[] | null;
  mediaIds: string[] | null;
  videoUrl: string | null;
  videoTitle: string | null;
  seoTitle: string;
  seoDescription: string;
  readingMinutes: number;
  status: KnowledgeBaseArticleStatus;
  botTrainingEnabled: boolean;
  popular: boolean;
  topSearched: boolean;
  publishedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type KnowledgeBaseArticleInput = {
  id?: string;
  role?: KnowledgeBaseRole;
  categoryId?: string | null;
  slug?: string;
  title?: string;
  summary?: string;
  intro?: string;
  bodyBlocks?: KnowledgeBaseBlock[];
  steps?: KnowledgeBaseStep[];
  importantNotes?: string[];
  faqs?: KnowledgeBaseFaq[];
  relatedSlugs?: string[];
  tags?: string[];
  filterGroups?: string[];
  mediaIds?: string[];
  videoUrl?: string | null;
  videoTitle?: string | null;
  seoTitle?: string;
  seoDescription?: string;
  status?: KnowledgeBaseArticleStatus;
  botTrainingEnabled?: boolean;
  popular?: boolean;
  topSearched?: boolean;
};

export type KnowledgeBaseCategoryInput = {
  id?: string;
  role?: KnowledgeBaseRole;
  slug?: string;
  title?: string;
  description?: string;
  iconKey?: string;
  sortOrder?: number;
};

const ROLE_PATH: Record<KnowledgeBaseRole, string> = {
  AGENCY: "agency",
  FREELANCER: "freelancer",
  PLATFORM: "platform",
};

const SEARCH_STOP_WORDS = new Set([
  "and",
  "are",
  "can",
  "for",
  "from",
  "how",
  "the",
  "to",
  "with",
  "you",
  "your",
  "gigxomi",
  "work",
  "works",
  "help",
  "need",
  "what",
]);

let tableBootstrapPromise: Promise<void> | null = null;
let databaseRetryAfter = 0;

function noteKnowledgeBaseDatabaseFailure() {
  tableBootstrapPromise = null;
  databaseRetryAfter = Date.now() + 30_000;
}

function nowIso() {
  return new Date().toISOString();
}

function getDatabaseEndpoint() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  try {
    const parsed = new URL(databaseUrl);
    if (!parsed.protocol.includes("postgres") || !parsed.hostname) {
      return null;
    }

    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
    };
  } catch {
    return null;
  }
}

function canReachDatabaseEndpoint(timeoutMs = 250) {
  const endpoint = getDatabaseEndpoint();
  if (!endpoint) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const socket = new Socket();
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
    socket.connect(endpoint.port, endpoint.host);
  });
}

async function canWriteKnowledgeBaseTelemetry() {
  if (Date.now() < databaseRetryAfter) {
    return false;
  }

  const canConnect = await canReachDatabaseEndpoint();
  if (!canConnect) {
    noteKnowledgeBaseDatabaseFailure();
    return false;
  }

  return true;
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function rolePath(role: KnowledgeBaseRole) {
  return ROLE_PATH[role];
}

export function buildKnowledgeBaseArticlePath(role: KnowledgeBaseRole, slug: string) {
  return `/knowledge-base/${ROLE_PATH[role]}/${slug}`;
}

export function buildKnowledgeBaseArticleUrl(role: KnowledgeBaseRole, slug: string) {
  return buildSiteUrl(buildKnowledgeBaseArticlePath(role, slug));
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function makeId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function normalizeRole(value: unknown, fallback: KnowledgeBaseRole = "PLATFORM"): KnowledgeBaseRole {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "FREELANCER" || normalized === "AGENCY" || normalized === "PLATFORM") return normalized;
  return fallback;
}

function normalizeStatus(value: unknown, fallback: KnowledgeBaseArticleStatus = "DRAFT"): KnowledgeBaseArticleStatus {
  return String(value ?? "").trim().toUpperCase() === "PUBLISHED" ? "PUBLISHED" : fallback;
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[] = []) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : fallback;
  return Array.from(new Set(source.map((item) => String(item).trim()).filter(Boolean)));
}

function parseJsonArray<T>(value: unknown, fallback: T[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeBlocks(value: unknown): KnowledgeBaseBlock[] {
  return parseJsonArray<Partial<KnowledgeBaseBlock>>(value, [])
    .map((block) => ({
      title: asText(block.title),
      body: asText(block.body),
    }))
    .filter((block) => block.title || block.body);
}

function normalizeSteps(value: unknown): KnowledgeBaseStep[] {
  return parseJsonArray<Partial<KnowledgeBaseStep>>(value, [])
    .map((step, index) => ({
      title: asText(step.title, `Step ${index + 1}`),
      body: asText(step.body),
    }))
    .filter((step) => step.title || step.body);
}

function normalizeFaqs(value: unknown): KnowledgeBaseFaq[] {
  return parseJsonArray<Partial<KnowledgeBaseFaq>>(value, [])
    .map((item) => ({
      question: asText(item.question),
      answer: asText(item.answer),
    }))
    .filter((item) => item.question && item.answer);
}

function textForReadingTime(input: Pick<KnowledgeBaseArticleInput, "title" | "summary" | "intro" | "bodyBlocks" | "steps" | "importantNotes" | "faqs">) {
  return [
    input.title,
    input.summary,
    input.intro,
    ...(input.bodyBlocks ?? []).flatMap((block) => [block.title, block.body]),
    ...(input.steps ?? []).flatMap((step) => [step.title, step.body]),
    ...(input.importantNotes ?? []),
    ...(input.faqs ?? []).flatMap((faq) => [faq.question, faq.answer]),
  ]
    .filter(Boolean)
    .join(" ");
}

function calculateReadingMinutes(input: Pick<KnowledgeBaseArticleInput, "title" | "summary" | "intro" | "bodyBlocks" | "steps" | "importantNotes" | "faqs">) {
  const words = textForReadingTime(input).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 190));
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9+#.\s-]/g, " ")
        .split(/[\s-]+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 2 && !SEARCH_STOP_WORDS.has(term)),
    ),
  );
}

function articleSearchText(article: KnowledgeBaseArticle) {
  return [
    article.title,
    article.summary,
    article.intro,
    article.category?.title,
    ...article.tags,
    ...article.filterGroups,
    ...article.importantNotes,
    ...article.bodyBlocks.flatMap((block) => [block.title, block.body]),
    ...article.steps.flatMap((step) => [step.title, step.body]),
    ...article.faqs.flatMap((faq) => [faq.question, faq.answer]),
  ]
    .filter(Boolean)
    .join(" ");
}

function scoreArticle(article: KnowledgeBaseArticle, queryTerms: string[], filters: string[]) {
  if (!queryTerms.length && !filters.length) return 1;
  const searchable = articleSearchText(article).toLowerCase();
  const title = article.title.toLowerCase();
  const tags = new Set([...article.tags, ...article.filterGroups].map((item) => item.toLowerCase()));
  let score = 0;
  const matchedTerms = new Set<string>();

  for (const term of queryTerms) {
    if (title.includes(term)) {
      score += 8;
      matchedTerms.add(term);
    } else if (tags.has(term)) {
      score += 5;
      matchedTerms.add(term);
    } else if (searchable.includes(term)) {
      score += 2;
      matchedTerms.add(term);
    }
  }

  for (const filter of filters.map((item) => item.toLowerCase())) {
    if (article.role.toLowerCase() === filter || tags.has(filter) || article.category?.slug === filter) {
      score += 6;
      matchedTerms.add(filter);
    }
  }

  if (article.popular) score += 0.5;
  return { score, matchedTerms: [...matchedTerms] };
}

function mapCategory(row: CategoryRow): KnowledgeBaseCategory {
  return {
    ...row,
    createdAt: toIso(row.createdAt) ?? nowIso(),
    updatedAt: toIso(row.updatedAt) ?? nowIso(),
  };
}

function mapMedia(row: MediaRow): KnowledgeBaseMedia {
  return {
    ...row,
    createdAt: toIso(row.createdAt) ?? nowIso(),
    updatedAt: toIso(row.updatedAt) ?? nowIso(),
  };
}

function mapArticle(
  row: ArticleRow,
  categoriesById: Map<string, KnowledgeBaseCategory>,
  mediaById: Map<string, KnowledgeBaseMedia>,
): KnowledgeBaseArticle {
  const mediaIds = asStringArray(row.mediaIds);
  const article: KnowledgeBaseArticle = {
    id: row.id,
    role: normalizeRole(row.role),
    categoryId: row.categoryId,
    category: row.categoryId ? categoriesById.get(row.categoryId) ?? null : null,
    slug: row.slug,
    href: buildKnowledgeBaseArticlePath(normalizeRole(row.role), row.slug),
    title: row.title,
    summary: row.summary,
    intro: row.intro,
    bodyBlocks: normalizeBlocks(row.bodyBlocks),
    steps: normalizeSteps(row.steps),
    importantNotes: asStringArray(row.importantNotes),
    faqs: normalizeFaqs(row.faqs),
    relatedSlugs: asStringArray(row.relatedSlugs),
    tags: asStringArray(row.tags),
    filterGroups: asStringArray(row.filterGroups),
    mediaIds,
    media: mediaIds.map((id) => mediaById.get(id)).filter((item): item is KnowledgeBaseMedia => Boolean(item)),
    videoUrl: row.videoUrl,
    videoTitle: row.videoTitle,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    readingMinutes: row.readingMinutes,
    status: normalizeStatus(row.status),
    botTrainingEnabled: row.botTrainingEnabled,
    popular: row.popular,
    topSearched: row.topSearched,
    publishedAt: toIso(row.publishedAt),
    createdAt: toIso(row.createdAt) ?? nowIso(),
    updatedAt: toIso(row.updatedAt) ?? nowIso(),
  };
  return article;
}

const defaultMedia: KnowledgeBaseMedia[] = [
  {
    id: "media-agency-dashboard",
    kind: "SCREENSHOT",
    title: "Agency dashboard overview",
    alt: "Dark Gigxomi agency dashboard with active work, editor matches, and project metrics.",
    url: "/knowledge-base/media/agency-dashboard.svg",
    mobileUrl: "/knowledge-base/media/mobile-preview.svg",
    thumbnailUrl: null,
    sortOrder: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: "media-freelancer-dashboard",
    kind: "SCREENSHOT",
    title: "Freelancer dashboard",
    alt: "Gigxomi freelancer dashboard showing matched work, profile strength, chats, and wallet snapshot.",
    url: "/knowledge-base/media/freelancer-dashboard.svg",
    mobileUrl: "/knowledge-base/media/mobile-preview.svg",
    thumbnailUrl: null,
    sortOrder: 2,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: "media-chat-system",
    kind: "SCREENSHOT",
    title: "Project chat system",
    alt: "Project-based Gigxomi chat showing customer lane, internal lane, attachments, and status context.",
    url: "/knowledge-base/media/chat-system.svg",
    mobileUrl: "/knowledge-base/media/mobile-preview.svg",
    thumbnailUrl: null,
    sortOrder: 3,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: "media-create-work-form",
    kind: "SCREENSHOT",
    title: "Create work form",
    alt: "Gigxomi agency create work form with title, niche, budget, timeline, and matching tags.",
    url: "/knowledge-base/media/create-work-form.svg",
    mobileUrl: "/knowledge-base/media/mobile-preview.svg",
    thumbnailUrl: null,
    sortOrder: 4,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: "media-editor-applications",
    kind: "SCREENSHOT",
    title: "Editor applications panel",
    alt: "Agency application review panel with editor proposals, match scores, shortlist, accept, and reject controls.",
    url: "/knowledge-base/media/editor-applications.svg",
    mobileUrl: "/knowledge-base/media/mobile-preview.svg",
    thumbnailUrl: null,
    sortOrder: 5,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: "media-wallet-payments",
    kind: "SCREENSHOT",
    title: "Wallet and payment screen",
    alt: "Gigxomi wallet screen showing transparent payment requests, payout status, and ledger entries.",
    url: "/knowledge-base/media/wallet-payments.svg",
    mobileUrl: "/knowledge-base/media/mobile-preview.svg",
    thumbnailUrl: null,
    sortOrder: 6,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: "media-notifications",
    kind: "SCREENSHOT",
    title: "Notifications panel",
    alt: "Real-time notifications panel for approvals, chat messages, payment updates, and project workflow changes.",
    url: "/knowledge-base/media/notifications-panel.svg",
    mobileUrl: "/knowledge-base/media/mobile-preview.svg",
    thumbnailUrl: null,
    sortOrder: 7,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
];

const defaultCategories: KnowledgeBaseCategory[] = [
  { id: "cat-freelancer-started", role: "FREELANCER", slug: "getting-started", title: "Getting Started", description: "Set up your editor workspace and understand where work appears.", iconKey: "rocket", sortOrder: 1, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-freelancer-profile", role: "FREELANCER", slug: "profile-setup", title: "Profile Setup", description: "Build a profile that agencies can trust and match against.", iconKey: "user", sortOrder: 2, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-freelancer-apply", role: "FREELANCER", slug: "applying-for-work", title: "Applying For Work", description: "Find matched opportunities and send focused proposals.", iconKey: "send", sortOrder: 3, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-freelancer-chat", role: "FREELANCER", slug: "chat-system", title: "Chat System", description: "Understand project chats, internal coordination, and unlocked client lanes.", iconKey: "message", sortOrder: 4, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-freelancer-money", role: "FREELANCER", slug: "payment-withdrawals", title: "Payment & Withdrawals", description: "Track payment requests, ledger entries, and payout readiness.", iconKey: "wallet", sortOrder: 5, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-freelancer-verification", role: "FREELANCER", slug: "account-verification", title: "Account Verification", description: "Keep your editor account trusted and ready for higher-intent agency work.", iconKey: "shield", sortOrder: 6, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-agency-dashboard", role: "AGENCY", slug: "agency-dashboard", title: "Agency Dashboard", description: "Manage active work, editors, applications, chats, and delivery status.", iconKey: "building", sortOrder: 1, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-agency-posting", role: "AGENCY", slug: "posting-work", title: "Posting Work", description: "Create clear work opportunities that Gigxomi can match to editors.", iconKey: "briefcase", sortOrder: 2, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-agency-editors", role: "AGENCY", slug: "finding-editors", title: "Finding Editors", description: "Review recommended editors, invite specialists, and compare applications.", iconKey: "users", sortOrder: 3, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-agency-chat", role: "AGENCY", slug: "chat-communication", title: "Chat & Communication", description: "Use customer, internal, and editor lanes without losing project context.", iconKey: "message", sortOrder: 4, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-agency-hiring", role: "AGENCY", slug: "hiring-workflow", title: "Hiring Workflow", description: "Move from application review to accepted editor and organized delivery.", iconKey: "check", sortOrder: 5, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-agency-analytics", role: "AGENCY", slug: "analytics", title: "Analytics", description: "Track signals that help scale your editing operation.", iconKey: "chart", sortOrder: 6, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "cat-platform-ai", role: "PLATFORM", slug: "ask-gigxomi-ai", title: "Ask Gigxomi AI", description: "Future-ready help search that recommends support articles and handoff paths.", iconKey: "sparkles", sortOrder: 1, createdAt: nowIso(), updatedAt: nowIso() },
];

const defaultArticles: KnowledgeBaseArticleInput[] = [
  {
    id: "kb-freelancer-how-to-apply",
    role: "FREELANCER",
    categoryId: "cat-freelancer-apply",
    slug: "how-to-apply",
    title: "How To Apply For Work",
    summary: "Learn how matched work appears, how to choose relevant agency opportunities, and how to send a proposal that can be approved.",
    intro: "Gigxomi does not work like a generic gig board. Agencies post editor requirements, Gigxomi matches those requirements to relevant editors, and editors apply with a focused proposal.",
    bodyBlocks: [
      { title: "Where available work appears", body: "Open your freelancer dashboard and go to Available Work. You will see work that matches your profile, services, skills, niche, or direct agency invite." },
      { title: "What agencies see", body: "Agencies review your proposal, expected delivery, portfolio links, availability, and match signals before accepting. Your contact details stay controlled inside Gigxomi." },
    ],
    steps: [
      { title: "Open Dashboard", body: "Sign in as a freelancer and open the Gigxomi freelancer dashboard." },
      { title: "Navigate to Available Work", body: "Choose Available Work or Work Matching from your workspace." },
      { title: "Select relevant niche work", body: "Review title, category, budget, deadline, required skills, and match percentage before applying." },
      { title: "Click Apply", body: "Open the proposal form only when the requirement fits your editing niche and availability." },
      { title: "Send proposal", body: "Add a short proposal, expected delivery, expected payout, and relevant portfolio or service links." },
      { title: "Wait for agency approval", body: "The agency can shortlist, accept, or reject. If accepted, Gigxomi creates an active agency-editor connection." },
    ],
    importantNotes: [
      "Chat access opens after the agency accepts your application or invite.",
      "A stronger profile and service tags improve matching quality.",
      "Do not send external contact information inside proposals unless Gigxomi policy allows it.",
    ],
    faqs: [
      { question: "Why can I not see every work post?", answer: "Gigxomi shows work based on matching signals and invites, so editors see opportunities that are relevant to their profile and services." },
      { question: "What happens after approval?", answer: "The work moves into an active connection and the chat/project workflow becomes available for organized communication." },
    ],
    relatedSlugs: ["profile-setup", "chat-system", "payments-withdrawals"],
    tags: ["apply", "available work", "proposal", "matched work", "agency approval"],
    filterGroups: ["Freelancer", "Projects"],
    mediaIds: ["media-freelancer-dashboard", "media-editor-applications"],
    videoUrl: "",
    videoTitle: "Applying for matched agency work",
    seoTitle: "How To Apply For Work On Gigxomi | Freelancer Guide",
    seoDescription: "Step-by-step guide for freelancers applying to agency work opportunities on Gigxomi.",
    status: "PUBLISHED",
    popular: true,
    topSearched: true,
  },
  {
    id: "kb-agency-hire-editors",
    role: "AGENCY",
    categoryId: "cat-agency-hiring",
    slug: "hire-editors",
    title: "How Agencies Can Hire Editors",
    summary: "Post work, review editor applications, and accept the right editor while keeping the workflow organized inside Gigxomi.",
    intro: "Agencies use Gigxomi to scale editing capacity without hiring permanently. The workflow starts with a clear work post and ends with an accepted editor connection.",
    bodyBlocks: [
      { title: "The hiring model", body: "Agencies create work requirements with niche, budget, timeline, skills, and expected output. Gigxomi ranks editors and applications around those signals." },
      { title: "After acceptance", body: "When an editor is accepted, Gigxomi creates an active work connection and the project chat can be used for organized communication and delivery coordination." },
    ],
    steps: [
      { title: "Open Agency Dashboard", body: "Sign in as an agency admin or super admin and open Work Matching." },
      { title: "Click Create Work", body: "Start a new work post for the editing requirement." },
      { title: "Add title, niche, budget, timeline", body: "Use concrete project details so the matcher can rank editors accurately." },
      { title: "Publish work", body: "Make the post visible to matched editors, private invites, or your agency team." },
      { title: "Review editor applications", body: "Compare proposals, match percentages, portfolio links, expected delivery, and payout expectations." },
      { title: "Accept suitable editor", body: "Accept the best-fit application or invite response to create an active connection." },
    ],
    importantNotes: [
      "Matched editor recommendations depend on the detail inside your work post.",
      "Accepting an editor creates the organized workflow; chatting before approval is intentionally controlled.",
      "Use internal notes and project statuses so your team can follow the handoff.",
    ],
    faqs: [
      { question: "Can agencies invite editors directly?", answer: "Yes. Agencies can invite recommended editors when they want a specialist rather than waiting for applications." },
      { question: "Does accepting an editor expose customer details?", answer: "No. Gigxomi keeps customer communication controlled and opens direct lanes only when permissions allow it." },
    ],
    relatedSlugs: ["post-work", "finding-editors", "chat-communication"],
    tags: ["hire editors", "create work", "applications", "accept editor", "agency workflow"],
    filterGroups: ["Agency", "Projects"],
    mediaIds: ["media-agency-dashboard", "media-create-work-form", "media-editor-applications"],
    videoUrl: "",
    videoTitle: "Hiring editors from agency dashboard",
    seoTitle: "How Agencies Hire Editors On Gigxomi",
    seoDescription: "Learn how agencies post work, review applications, and hire editors inside Gigxomi.",
    status: "PUBLISHED",
    popular: true,
    topSearched: true,
  },
  {
    id: "kb-platform-chat-system",
    role: "PLATFORM",
    categoryId: "cat-platform-ai",
    slug: "chat-system",
    title: "How Chat System Works",
    summary: "Understand Gigxomi's real-time, project-based chat lanes for agencies, managers, freelancers, and support.",
    intro: "Gigxomi chat keeps project communication organized. It is built around customer lanes, internal lanes, editor access controls, notifications, and attachments.",
    bodyBlocks: [
      { title: "Real-time messaging", body: "Chats refresh quickly, support typing indicators, read status, and notifications so teams can respond without losing context." },
      { title: "Controlled communication", body: "Freelancers do not automatically get direct customer access. Direct client chat is unlocked only after admin or manager approval when the project requires it." },
      { title: "Project-based chats", body: "Each important lead or accepted work relationship keeps messages, payment requests, internal notes, and assignments tied to one workspace." },
    ],
    steps: [
      { title: "Open the chat hub", body: "Use the agency, manager, freelancer, or super-admin chat section depending on your role." },
      { title: "Choose a thread", body: "Filter by unread, assigned, waiting, agency, or lead status to find the right conversation." },
      { title: "Use the right lane", body: "Use customer lane for client-visible replies and internal lane for private operations coordination." },
      { title: "Attach context", body: "Share images, videos, documents, voice notes, payment requests, or internal notes when allowed by the lane." },
      { title: "Track status", body: "Update lead status, assignment, and payment state from the same conversation context." },
    ],
    importantNotes: [
      "Media sharing is allowed only where the current lane and role permit it.",
      "Support bot handoffs create admin-visible context so humans do not start from zero.",
      "Project chats remain tied to workflow, not random one-off messages.",
    ],
    faqs: [
      { question: "When does chat unlock for freelancers?", answer: "Freelancer chat unlocks after an agency accepts an application or invite, and direct customer-lane access still depends on admin or manager permission." },
      { question: "Can users send files?", answer: "Yes, supported lanes can send media and documents. Some freelancer customer-lane replies remain text-only for control and privacy." },
    ],
    relatedSlugs: ["how-to-apply", "hire-editors", "project-workflow"],
    tags: ["chat", "messaging", "notifications", "media sharing", "project chats", "support"],
    filterGroups: ["Chat", "Projects"],
    mediaIds: ["media-chat-system", "media-notifications"],
    videoUrl: "",
    videoTitle: "Understanding Gigxomi chat lanes",
    seoTitle: "How Gigxomi Chat System Works",
    seoDescription: "Learn about Gigxomi real-time project chat, internal lanes, notifications, and controlled communication.",
    status: "PUBLISHED",
    popular: true,
    topSearched: true,
  },
  {
    id: "kb-platform-book-service",
    role: "PLATFORM",
    categoryId: "cat-platform-ai",
    slug: "book-service",
    title: "How To Book A Service On Gigxomi",
    summary: "Learn how visitors can find the right editing service, share requirements, and get help from Gigxomi support.",
    intro: "If you came to Gigxomi to book a service, start by searching for the service type or asking the support bot what you need. The support flow helps you move from requirement to the right next step.",
    bodyBlocks: [
      { title: "Start with your requirement", body: "Search for the type of service you need, such as short-form editing, long-form editing, thumbnails, reels, YouTube editing, or design support." },
      { title: "Share useful project details", body: "Keep your requirement practical: video length, deadline, editing style, reference links, budget comfort, and how quickly you need a response." },
      { title: "Use support when unsure", body: "If you are not sure which service fits, ask the support bot in plain language. It can suggest help articles or connect you with a human support member." },
    ],
    steps: [
      { title: "Open Gigxomi home or knowledge base", body: "Use the search bar or support bot from the bottom-right button." },
      { title: "Type what you need", body: "Ask questions like 'how to book a service', 'I need YouTube video editing', or 'I need reels edited fast'." },
      { title: "Review suggested articles", body: "Open the suggested guide or support link that matches your need." },
      { title: "Contact support if needed", body: "Use Talk to human when you want help choosing the right service path." },
    ],
    importantNotes: [
      "The support bot focuses on practical help and official Gigxomi knowledge base articles.",
      "Do not share sensitive payment details in chat unless you are on an official Gigxomi payment flow.",
      "For urgent service booking questions, use the human handoff so support can continue on WhatsApp.",
    ],
    faqs: [
      { question: "Can I ask the bot what service I need?", answer: "Yes. Describe your project in simple words and the bot will suggest relevant support content or a human handoff." },
      { question: "What should I include before booking?", answer: "Share service type, style, deadline, reference links, and any must-have delivery details." },
    ],
    relatedSlugs: ["chat-system", "notifications", "project-workflow"],
    tags: ["book service", "booking", "service booking", "hire service", "customer support", "contact support"],
    filterGroups: ["Platform", "Projects"],
    mediaIds: ["media-chat-system", "media-notifications"],
    seoTitle: "How To Book A Service On Gigxomi",
    seoDescription: "Learn how to search, ask support, and book the right service on Gigxomi.",
    status: "PUBLISHED",
    popular: true,
    topSearched: true,
  },
  {
    id: "kb-agency-post-work",
    role: "AGENCY",
    categoryId: "cat-agency-posting",
    slug: "post-work",
    title: "How To Post Work As An Agency",
    summary: "Create work posts that attract the right editors and improve matching quality.",
    intro: "A clear work post helps Gigxomi rank editors accurately and helps editors decide whether to apply.",
    bodyBlocks: [
      { title: "What to include", body: "Add category, niche, required skills, expected output, budget range, sample links, and timeline. These fields are matching signals." },
      { title: "Visibility choices", body: "Use public matched visibility for broad matching, private invites for targeted hiring, or agency team visibility for internal pools." },
    ],
    steps: [
      { title: "Open Work Matching", body: "From the agency dashboard, choose Create Work." },
      { title: "Describe the editing requirement", body: "Write the title, niche, style, output, and delivery expectations in plain language." },
      { title: "Add matching signals", body: "Add skills, tags, budget, experience level, deadline, and reference links." },
      { title: "Choose visibility", body: "Decide whether matched editors, invited editors, or team editors should see it." },
      { title: "Publish", body: "Publish the work and review recommended editors or incoming applications." },
    ],
    importantNotes: ["Specific tags outperform broad titles.", "Reference links help editors understand style before applying."],
    faqs: [{ question: "Can I pause a work post?", answer: "Yes. Agencies can pause, fill, close, or reopen work depending on current hiring status." }],
    relatedSlugs: ["hire-editors", "finding-editors"],
    tags: ["post work", "create work", "agency dashboard", "matching tags"],
    filterGroups: ["Agency", "Projects"],
    mediaIds: ["media-create-work-form"],
    seoTitle: "How To Post Work On Gigxomi",
    seoDescription: "Agency guide to creating matched work opportunities on Gigxomi.",
    status: "PUBLISHED",
    popular: true,
  },
  {
    id: "kb-freelancer-profile-setup",
    role: "FREELANCER",
    categoryId: "cat-freelancer-profile",
    slug: "profile-setup",
    title: "Profile Setup For Editors",
    summary: "Set up a freelancer profile that can be matched to real agency work.",
    intro: "Your Gigxomi profile is more than a bio. It feeds the matching system that agencies use to discover editors.",
    bodyBlocks: [
      { title: "Profile quality", body: "Use a clear display name, profession, bio, languages, service titles, tags, deliverables, and portfolio examples." },
      { title: "Matching signals", body: "Gigxomi uses service title, category, specialty, SEO keywords, tags, portfolio, and profile text when matching work." },
    ],
    steps: [
      { title: "Open Profile", body: "Go to your freelancer profile settings." },
      { title: "Add professional basics", body: "Update your name, role, bio, languages, and primary editing niche." },
      { title: "Publish services", body: "Add services with strong titles, categories, deliverables, and sample media." },
      { title: "Add portfolio evidence", body: "Attach links or uploads that prove your editing style and niche." },
      { title: "Keep it current", body: "Update availability and skills when your focus changes." },
    ],
    importantNotes: ["Better tags create better work matches.", "Generic bios are harder for agencies to evaluate."],
    faqs: [{ question: "Do I need a portfolio?", answer: "Yes. Portfolio links are one of the strongest trust signals for agency review." }],
    relatedSlugs: ["how-to-apply", "portfolio-upload", "account-verification"],
    tags: ["profile", "editor profile", "portfolio", "matching"],
    filterGroups: ["Freelancer"],
    mediaIds: ["media-freelancer-dashboard"],
    seoTitle: "Gigxomi Freelancer Profile Setup Guide",
    seoDescription: "How editors can set up a Gigxomi profile that matches to agency work.",
    status: "PUBLISHED",
  },
  {
    id: "kb-freelancer-payments-withdrawals",
    role: "FREELANCER",
    categoryId: "cat-freelancer-money",
    slug: "payments-withdrawals",
    title: "Payment & Withdrawals For Freelancers",
    summary: "Understand payment requests, wallet ledger, payouts, and transparent payment status inside Gigxomi.",
    intro: "Gigxomi keeps payment context visible so editors can track what has been requested, paid, and ready for payout.",
    bodyBlocks: [
      { title: "Payment requests", body: "Payment requests can appear inside project chats with amount, purpose, due label, payment method, and status." },
      { title: "Wallet and ledger", body: "Your wallet shows credits, payout requests, and ledger entries so you can understand how each project affects earnings." },
    ],
    steps: [
      { title: "Open Wallet", body: "Use the freelancer wallet or payouts section." },
      { title: "Review ledger entries", body: "Check project references, gross amount, commission, net amount, and status." },
      { title: "Confirm payout readiness", body: "Make sure payment details are saved and verification is complete." },
      { title: "Request payout", body: "Submit a payout request when eligible." },
    ],
    importantNotes: ["Payments should stay inside Gigxomi-supported workflows.", "UPI/payment details must be accurate before payout."],
    faqs: [{ question: "Where can I see payment status?", answer: "Open wallet, payouts, or the relevant project chat payment card." }],
    relatedSlugs: ["chat-system", "project-workflow"],
    tags: ["payments", "wallet", "withdrawals", "payouts", "UPI"],
    filterGroups: ["Freelancer", "Payments"],
    mediaIds: ["media-wallet-payments"],
    seoTitle: "Gigxomi Freelancer Payments And Withdrawals",
    seoDescription: "Learn how freelancer payments, wallet, ledger, and payout requests work on Gigxomi.",
    status: "PUBLISHED",
    topSearched: true,
  },
  {
    id: "kb-platform-project-workflow",
    role: "PLATFORM",
    categoryId: "cat-platform-ai",
    slug: "project-workflow",
    title: "How Project Workflow Stays Organized",
    summary: "See how Gigxomi keeps work posts, applications, approvals, chats, payments, and delivery status connected.",
    intro: "Gigxomi is built around an editor-agency workflow, so each stage keeps context for the next stage.",
    bodyBlocks: [
      { title: "Work to approval", body: "Agencies post work, editors apply, agencies review, and accepted editors become active connections." },
      { title: "Approval to delivery", body: "After approval, chat and project tracking help teams coordinate delivery, payment, feedback, and follow-up." },
    ],
    steps: [
      { title: "Agency posts work", body: "The agency defines the requirement and matching signals." },
      { title: "Editors apply or accept invites", body: "Relevant editors submit proposals or respond to invitations." },
      { title: "Agency reviews applications", body: "Applications are shortlisted, accepted, or rejected." },
      { title: "Chat unlocks after approval", body: "Project communication opens in controlled lanes after a real workflow connection exists." },
      { title: "Payments and delivery stay attached", body: "Payment requests, files, and notes stay in the project context." },
    ],
    importantNotes: ["Gigxomi workflow is not a generic Fiverr-like listing flow.", "Approvals and chat permissions protect agencies, editors, and customers."],
    faqs: [{ question: "Why are workflows controlled?", answer: "Controlled workflows reduce lost context, protect contact privacy, and keep work tied to real project status." }],
    relatedSlugs: ["how-to-apply", "hire-editors", "chat-system"],
    tags: ["workflow", "projects", "approval", "applications", "chat unlock"],
    filterGroups: ["Projects"],
    mediaIds: ["media-agency-dashboard", "media-chat-system"],
    seoTitle: "Gigxomi Project Workflow Guide",
    seoDescription: "How Gigxomi organizes agency-editor work from posting to approval, chat, payments, and delivery.",
    status: "PUBLISHED",
    popular: true,
  },
  {
    id: "kb-platform-notifications",
    role: "PLATFORM",
    categoryId: "cat-platform-ai",
    slug: "notifications",
    title: "Notifications And Real-Time Updates",
    summary: "Learn where Gigxomi sends updates for applications, chat, payments, invites, and project movement.",
    intro: "Notifications help agencies and editors respond quickly when a workflow changes.",
    bodyBlocks: [
      { title: "What triggers updates", body: "Gigxomi can notify users about matching work, new applications, accepted invites, chat messages, payment requests, and delivery reviews." },
      { title: "Where updates appear", body: "Updates can appear in dashboards, chat unread states, and mobile push where configured." },
    ],
    steps: [
      { title: "Open notifications", body: "Use the dashboard or mobile notifications area." },
      { title: "Review priority updates", body: "Look first for application, chat, payment, and approval messages." },
      { title: "Take action", body: "Open the linked work, chat, payment, or project page." },
    ],
    importantNotes: ["Real-time notifications depend on browser/mobile permissions and configured push tokens."],
    faqs: [{ question: "Why did I miss an update?", answer: "Check browser notification permissions, mobile push settings, and whether you are signed into the correct role workspace." }],
    relatedSlugs: ["chat-system", "project-workflow"],
    tags: ["notifications", "real-time", "push", "updates"],
    filterGroups: ["Chat", "Projects"],
    mediaIds: ["media-notifications"],
    seoTitle: "Gigxomi Notifications Guide",
    seoDescription: "Learn how notifications and real-time updates work inside Gigxomi.",
    status: "PUBLISHED",
  },
  {
    id: "kb-agency-project-tracking",
    role: "AGENCY",
    categoryId: "cat-agency-dashboard",
    slug: "project-tracking",
    title: "Project Tracking For Agencies",
    summary: "Track open work, accepted editors, chat context, payments, and delivery review without losing operations visibility.",
    intro: "Agency project tracking helps teams know what is open, who owns it, and what needs action.",
    bodyBlocks: [
      { title: "Operational view", body: "Track status, owner, assigned editor, payment stage, and unread communication from the agency or manager workspace." },
      { title: "Review flow", body: "Use delivery review and portfolio review areas to keep output quality and showcase permissions organized." },
    ],
    steps: [
      { title: "Open dashboard", body: "Use agency dashboard, manager project tracking, or chat details." },
      { title: "Filter by status", body: "Find waiting, assigned, payment pending, in-progress, delivered, or closed work." },
      { title: "Open thread details", body: "Review internal note, owner, assigned editor, payment request, and latest messages." },
    ],
    importantNotes: ["Project tracking works best when teams update statuses consistently."],
    faqs: [{ question: "Can managers track assigned work?", answer: "Yes. Manager views include assigned chats, tracking, reviews, wallet review, and escalations depending on permissions." }],
    relatedSlugs: ["hire-editors", "chat-communication", "analytics"],
    tags: ["project tracking", "agency", "delivery review", "status"],
    filterGroups: ["Agency", "Projects"],
    mediaIds: ["media-agency-dashboard"],
    seoTitle: "Gigxomi Project Tracking For Agencies",
    seoDescription: "Agency guide to tracking projects, editors, chats, payments, and delivery review on Gigxomi.",
    status: "PUBLISHED",
  },
  {
    id: "kb-agency-analytics",
    role: "AGENCY",
    categoryId: "cat-agency-analytics",
    slug: "analytics",
    title: "Agency Analytics Basics",
    summary: "Understand the operational signals agencies can use to scale editing workflows on Gigxomi.",
    intro: "Analytics help agencies identify capacity, response, matching, payment, and workflow trends.",
    bodyBlocks: [
      { title: "Useful signals", body: "Track open work, pending applications, recommended editors, active connections, payment pending work, unread chats, and delivery follow-ups." },
      { title: "How to use them", body: "Use the signals to decide whether to invite more editors, improve work post detail, adjust budget, or follow up with managers." },
    ],
    steps: [
      { title: "Open analytics-ready surfaces", body: "Use agency dashboard, work matching totals, chat filters, and marketing console where available." },
      { title: "Review bottlenecks", body: "Look for posts without applicants, payment pending threads, or repeated delivery follow-ups." },
      { title: "Improve workflow inputs", body: "Update work tags, budgets, skills, and expected output when matching quality is low." },
    ],
    importantNotes: ["Analytics are most useful when the team keeps statuses and ownership current."],
    faqs: [{ question: "Can analytics improve editor matching?", answer: "Yes. They reveal where work posts need clearer skills, tags, budgets, or references." }],
    relatedSlugs: ["post-work", "project-tracking"],
    tags: ["analytics", "agency dashboard", "metrics", "matching"],
    filterGroups: ["Agency"],
    mediaIds: ["media-agency-dashboard"],
    seoTitle: "Gigxomi Agency Analytics Guide",
    seoDescription: "Learn the core analytics signals agencies can use to manage and scale Gigxomi workflows.",
    status: "PUBLISHED",
  },
];

function fallbackArticles(options?: { includeDrafts?: boolean; role?: KnowledgeBaseRole }) {
  const categoriesById = new Map(defaultCategories.map((category) => [category.id, category]));
  const mediaById = new Map(defaultMedia.map((item) => [item.id, item]));
  return defaultArticles
    .filter((article) => (options?.includeDrafts ? true : normalizeStatus(article.status, "PUBLISHED") === "PUBLISHED"))
    .filter((article) => (options?.role ? normalizeRole(article.role) === options.role : true))
    .map((article): KnowledgeBaseArticle => {
      const role = normalizeRole(article.role);
      const title = asText(article.title, "Gigxomi Knowledge Base Article");
      const slug = slugify(asText(article.slug, title));
      const mediaIds = asStringArray(article.mediaIds);
      const timestamp = nowIso();
      return {
        id: asText(article.id, `${role}-${slug}`),
        role,
        categoryId: article.categoryId ?? null,
        category: article.categoryId ? categoriesById.get(article.categoryId) ?? null : null,
        slug,
        href: buildKnowledgeBaseArticlePath(role, slug),
        title,
        summary: asText(article.summary),
        intro: asText(article.intro, article.summary),
        bodyBlocks: normalizeBlocks(article.bodyBlocks),
        steps: normalizeSteps(article.steps),
        importantNotes: asStringArray(article.importantNotes),
        faqs: normalizeFaqs(article.faqs),
        relatedSlugs: asStringArray(article.relatedSlugs),
        tags: asStringArray(article.tags),
        filterGroups: asStringArray(article.filterGroups),
        mediaIds,
        media: mediaIds.map((id) => mediaById.get(id)).filter((item): item is KnowledgeBaseMedia => Boolean(item)),
        videoUrl: asText(article.videoUrl) || null,
        videoTitle: asText(article.videoTitle) || null,
        seoTitle: asText(article.seoTitle, title),
        seoDescription: asText(article.seoDescription, article.summary),
        readingMinutes: calculateReadingMinutes(article),
        status: normalizeStatus(article.status, "PUBLISHED"),
        botTrainingEnabled: asBoolean(article.botTrainingEnabled, true),
        popular: asBoolean(article.popular, false),
        topSearched: asBoolean(article.topSearched, false),
        publishedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });
}

export function listFallbackPublishedKnowledgeBaseArticles() {
  return fallbackArticles();
}

function buildArticleChunks(article: KnowledgeBaseArticleInput & { id: string; role: KnowledgeBaseRole; slug: string; title: string; summary: string }) {
  const sections = [
    article.summary,
    article.intro,
    ...(article.bodyBlocks ?? []).map((block) => `${block.title}. ${block.body}`),
    ...(article.steps ?? []).map((step, index) => `Step ${index + 1}: ${step.title}. ${step.body}`),
    ...(article.importantNotes ?? []).map((note) => `Important note: ${note}`),
    ...(article.faqs ?? []).map((faq) => `Question: ${faq.question}. Answer: ${faq.answer}`),
  ].filter(Boolean);

  return sections.map((content, index) => {
    const fullContent = `${article.title}. ${content}`;
    return {
      id: `${article.id}-chunk-${index + 1}`,
      content: fullContent,
      keywords: tokenize(`${fullContent} ${(article.tags ?? []).join(" ")} ${(article.filterGroups ?? []).join(" ")}`),
    };
  });
}

async function ensureKnowledgeBaseTables() {
  if (Date.now() < databaseRetryAfter) {
    throw new Error("Knowledge base database is temporarily unavailable.");
  }

  if (!tableBootstrapPromise) {
    tableBootstrapPromise = (async () => {
      const canConnect = await canReachDatabaseEndpoint();
      if (!canConnect) {
        noteKnowledgeBaseDatabaseFailure();
        throw new Error("Knowledge base database endpoint is not reachable.");
      }

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "KnowledgeBaseCategory" (
          "id" TEXT PRIMARY KEY,
          "role" TEXT NOT NULL,
          "slug" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "description" TEXT NOT NULL,
          "iconKey" TEXT NOT NULL,
          "sortOrder" INTEGER NOT NULL DEFAULT 100,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeBaseCategory_role_slug_key" ON "KnowledgeBaseCategory"("role", "slug");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KnowledgeBaseCategory_role_sortOrder_idx" ON "KnowledgeBaseCategory"("role", "sortOrder");`);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "KnowledgeBaseMedia" (
          "id" TEXT PRIMARY KEY,
          "kind" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "alt" TEXT NOT NULL,
          "url" TEXT NOT NULL,
          "mobileUrl" TEXT,
          "thumbnailUrl" TEXT,
          "sortOrder" INTEGER NOT NULL DEFAULT 100,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "KnowledgeBaseArticle" (
          "id" TEXT PRIMARY KEY,
          "role" TEXT NOT NULL,
          "categoryId" TEXT,
          "slug" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "summary" TEXT NOT NULL,
          "intro" TEXT NOT NULL,
          "bodyBlocks" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "steps" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "importantNotes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "faqs" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "relatedSlugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "filterGroups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "mediaIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "videoUrl" TEXT,
          "videoTitle" TEXT,
          "seoTitle" TEXT NOT NULL,
          "seoDescription" TEXT NOT NULL,
          "readingMinutes" INTEGER NOT NULL DEFAULT 2,
          "status" TEXT NOT NULL DEFAULT 'DRAFT',
          "botTrainingEnabled" BOOLEAN NOT NULL DEFAULT true,
          "popular" BOOLEAN NOT NULL DEFAULT false,
          "topSearched" BOOLEAN NOT NULL DEFAULT false,
          "publishedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeBaseArticle_role_slug_key" ON "KnowledgeBaseArticle"("role", "slug");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KnowledgeBaseArticle_status_role_idx" ON "KnowledgeBaseArticle"("status", "role");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KnowledgeBaseArticle_categoryId_idx" ON "KnowledgeBaseArticle"("categoryId");`);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "KnowledgeBaseChunk" (
          "id" TEXT PRIMARY KEY,
          "articleId" TEXT NOT NULL,
          "role" TEXT NOT NULL,
          "slug" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "content" TEXT NOT NULL,
          "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KnowledgeBaseChunk_articleId_idx" ON "KnowledgeBaseChunk"("articleId");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KnowledgeBaseChunk_role_idx" ON "KnowledgeBaseChunk"("role");`);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "KnowledgeBaseFeedback" (
          "id" TEXT PRIMARY KEY,
          "articleId" TEXT NOT NULL,
          "helpful" BOOLEAN NOT NULL,
          "comment" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KnowledgeBaseFeedback_articleId_idx" ON "KnowledgeBaseFeedback"("articleId");`);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "KnowledgeBaseSearchEvent" (
          "id" TEXT PRIMARY KEY,
          "query" TEXT NOT NULL,
          "role" TEXT,
          "filters" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "resultCount" INTEGER NOT NULL DEFAULT 0,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KnowledgeBaseSearchEvent_createdAt_idx" ON "KnowledgeBaseSearchEvent"("createdAt");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KnowledgeBaseSearchEvent_role_idx" ON "KnowledgeBaseSearchEvent"("role");`);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SupportBotSession" (
          "id" TEXT PRIMARY KEY,
          "visitorName" TEXT,
          "visitorPhone" TEXT,
          "status" TEXT NOT NULL DEFAULT 'ACTIVE',
          "handoffConversationId" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SupportBotMessage" (
          "id" TEXT PRIMARY KEY,
          "sessionId" TEXT NOT NULL,
          "role" TEXT NOT NULL,
          "body" TEXT NOT NULL,
          "sources" JSONB,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportBotMessage_sessionId_createdAt_idx" ON "SupportBotMessage"("sessionId", "createdAt");`);

      await seedKnowledgeBaseIfEmpty();
    })().catch((error) => {
      noteKnowledgeBaseDatabaseFailure();
      throw error;
    });
  }

  return tableBootstrapPromise;
}

async function seedKnowledgeBaseIfEmpty() {
  for (const media of defaultMedia) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "KnowledgeBaseMedia" ("id", "kind", "title", "alt", "url", "mobileUrl", "thumbnailUrl", "sortOrder")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT ("id") DO NOTHING;
    `,
      media.id,
      media.kind,
      media.title,
      media.alt,
      media.url,
      media.mobileUrl,
      media.thumbnailUrl,
      media.sortOrder,
    );
  }

  for (const category of defaultCategories) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "KnowledgeBaseCategory" ("id", "role", "slug", "title", "description", "iconKey", "sortOrder")
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT ("role", "slug") DO NOTHING;
    `,
      category.id,
      category.role,
      category.slug,
      category.title,
      category.description,
      category.iconKey,
      category.sortOrder,
    );
  }

  for (const article of defaultArticles) {
    if (article.id) {
      const existingRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "KnowledgeBaseArticle" WHERE "id" = $1 LIMIT 1;`, article.id);
      if (existingRows.length) {
        continue;
      }
    }
    await saveKnowledgeBaseArticle(article, { skipEnsure: true });
  }
}

async function readCategories() {
  try {
    await ensureKnowledgeBaseTables();
    const rows = await prisma.$queryRawUnsafe<CategoryRow[]>(`SELECT * FROM "KnowledgeBaseCategory" ORDER BY "role", "sortOrder", "title";`);
    return rows.map(mapCategory);
  } catch {
    return defaultCategories;
  }
}

async function readMedia() {
  try {
    await ensureKnowledgeBaseTables();
    const rows = await prisma.$queryRawUnsafe<MediaRow[]>(`SELECT * FROM "KnowledgeBaseMedia" ORDER BY "sortOrder", "title";`);
    return rows.map(mapMedia);
  } catch {
    return defaultMedia;
  }
}

async function readArticles(options?: { includeDrafts?: boolean; role?: KnowledgeBaseRole }) {
  try {
    await ensureKnowledgeBaseTables();
    const where: string[] = [];
    const params: unknown[] = [];
    if (!options?.includeDrafts) where.push(`"status" = 'PUBLISHED'`);
    if (options?.role) {
      params.push(options.role);
      where.push(`"role" = $${params.length}`);
    }
    const rows = await prisma.$queryRawUnsafe<ArticleRow[]>(
      `SELECT * FROM "KnowledgeBaseArticle"${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY "role", "publishedAt" DESC NULLS LAST, "updatedAt" DESC;`,
      ...params,
    );
    const [categories, media] = await Promise.all([readCategories(), readMedia()]);
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const mediaById = new Map(media.map((item) => [item.id, item]));
    return rows.map((row) => mapArticle(row, categoriesById, mediaById));
  } catch {
    return fallbackArticles(options);
  }
}

export async function listKnowledgeBaseCategories() {
  return readCategories();
}

export async function listKnowledgeBaseMedia() {
  return readMedia();
}

export async function listPublishedKnowledgeBaseArticles(role?: KnowledgeBaseRole) {
  return readArticles({ role });
}

export async function listAllKnowledgeBaseArticles() {
  return readArticles({ includeDrafts: true });
}

export async function getKnowledgeBaseHomeData(): Promise<KnowledgeBaseHomeData> {
  const [articles, categories, media] = await Promise.all([listPublishedKnowledgeBaseArticles(), listKnowledgeBaseCategories(), listKnowledgeBaseMedia()]);
  return {
    articles,
    categories,
    media,
    popularArticles: articles.filter((article) => article.popular).slice(0, 6),
    recentlyUpdated: [...articles].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 6),
    topSearched: articles.filter((article) => article.topSearched).slice(0, 6),
  };
}

export async function getKnowledgeBaseArticle(role: KnowledgeBaseRole, slug: string, options?: { includeDrafts?: boolean }) {
  const articles = await readArticles({ includeDrafts: options?.includeDrafts, role });
  return articles.find((article) => article.slug === slug) ?? null;
}

export async function getKnowledgeBaseArticleBySlug(slug: string) {
  const articles = await readArticles({ includeDrafts: true });
  return articles.find((article) => article.slug === slug) ?? null;
}

export async function getRelatedKnowledgeBaseArticles(article: KnowledgeBaseArticle, limit = 3) {
  const articles = await listPublishedKnowledgeBaseArticles();
  const bySlug = new Map(articles.map((item) => [item.slug, item]));
  const explicit = article.relatedSlugs.map((slug) => bySlug.get(slug)).filter((item): item is KnowledgeBaseArticle => Boolean(item));
  const fallback = articles
    .filter((item) => item.id !== article.id && !explicit.some((explicitArticle) => explicitArticle.id === item.id))
    .filter((item) => item.role === article.role || item.filterGroups.some((filter) => article.filterGroups.includes(filter)))
    .slice(0, limit);
  return [...explicit, ...fallback].slice(0, limit);
}

export async function searchKnowledgeBase(input: { query?: string; role?: KnowledgeBaseRole | null; filters?: string[]; limit?: number; recordEvent?: boolean }) {
  const query = asText(input.query);
  const role = input.role ? normalizeRole(input.role) : null;
  const filters = asStringArray(input.filters);
  const queryTerms = tokenize(query);
  const articles = await listPublishedKnowledgeBaseArticles(role ?? undefined);
  const results = articles
    .map((article) => {
      const scored = scoreArticle(article, queryTerms, filters);
      return { article, score: typeof scored === "number" ? scored : scored.score, matchedTerms: typeof scored === "number" ? [] : scored.matchedTerms };
    })
    .filter((result) => result.score > 0 || (!queryTerms.length && !filters.length))
    .sort((left, right) => right.score - left.score || Number(right.article.popular) - Number(left.article.popular))
    .slice(0, input.limit ?? 12);

  if (input.recordEvent !== false && (await canWriteKnowledgeBaseTelemetry())) {
    await prisma
      .$executeRawUnsafe(
        `INSERT INTO "KnowledgeBaseSearchEvent" ("id", "query", "role", "filters", "resultCount") VALUES ($1, $2, $3, $4::TEXT[], $5);`,
        makeId("kb-search"),
        query,
        role,
        filters,
        results.length,
      )
      .catch(() => undefined);
  }

  return results;
}

export async function saveKnowledgeBaseArticle(input: KnowledgeBaseArticleInput, options?: { skipEnsure?: boolean }) {
  if (!options?.skipEnsure) {
    await ensureKnowledgeBaseTables();
  }
  const existing = input.id
    ? (
        await prisma.$queryRawUnsafe<ArticleRow[]>(
          `SELECT * FROM "KnowledgeBaseArticle" WHERE "id" = $1 LIMIT 1;`,
          input.id,
        )
      )[0]
    : null;

  const role = normalizeRole(input.role, existing?.role ?? "PLATFORM");
  const title = asText(input.title, existing?.title ?? "Untitled article");
  const slug = slugify(asText(input.slug, existing?.slug ?? title)) || makeId("article");
  const bodyBlocks = input.bodyBlocks ?? normalizeBlocks(existing?.bodyBlocks);
  const steps = input.steps ?? normalizeSteps(existing?.steps);
  const faqs = input.faqs ?? normalizeFaqs(existing?.faqs);
  const importantNotes = input.importantNotes ?? asStringArray(existing?.importantNotes);
  const summary = asText(input.summary, existing?.summary ?? "");
  const intro = asText(input.intro, existing?.intro ?? summary);
  const status = normalizeStatus(input.status, existing?.status ?? "DRAFT");
  const articleId = existing?.id ?? input.id ?? makeId("kb");
  const readingMinutes = calculateReadingMinutes({ title, summary, intro, bodyBlocks, steps, importantNotes, faqs });
  const publishedAt = status === "PUBLISHED" ? existing?.publishedAt ?? new Date() : null;

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "KnowledgeBaseArticle" (
      "id", "role", "categoryId", "slug", "title", "summary", "intro", "bodyBlocks", "steps", "importantNotes", "faqs",
      "relatedSlugs", "tags", "filterGroups", "mediaIds", "videoUrl", "videoTitle", "seoTitle", "seoDescription", "readingMinutes",
      "status", "botTrainingEnabled", "popular", "topSearched", "publishedAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::TEXT[], $11::jsonb,
      $12::TEXT[], $13::TEXT[], $14::TEXT[], $15::TEXT[], $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO UPDATE SET
      "role" = EXCLUDED."role",
      "categoryId" = EXCLUDED."categoryId",
      "slug" = EXCLUDED."slug",
      "title" = EXCLUDED."title",
      "summary" = EXCLUDED."summary",
      "intro" = EXCLUDED."intro",
      "bodyBlocks" = EXCLUDED."bodyBlocks",
      "steps" = EXCLUDED."steps",
      "importantNotes" = EXCLUDED."importantNotes",
      "faqs" = EXCLUDED."faqs",
      "relatedSlugs" = EXCLUDED."relatedSlugs",
      "tags" = EXCLUDED."tags",
      "filterGroups" = EXCLUDED."filterGroups",
      "mediaIds" = EXCLUDED."mediaIds",
      "videoUrl" = EXCLUDED."videoUrl",
      "videoTitle" = EXCLUDED."videoTitle",
      "seoTitle" = EXCLUDED."seoTitle",
      "seoDescription" = EXCLUDED."seoDescription",
      "readingMinutes" = EXCLUDED."readingMinutes",
      "status" = EXCLUDED."status",
      "botTrainingEnabled" = EXCLUDED."botTrainingEnabled",
      "popular" = EXCLUDED."popular",
      "topSearched" = EXCLUDED."topSearched",
      "publishedAt" = EXCLUDED."publishedAt",
      "updatedAt" = CURRENT_TIMESTAMP;
    `,
    articleId,
    role,
    input.categoryId ?? existing?.categoryId ?? null,
    slug,
    title,
    summary,
    intro,
    JSON.stringify(bodyBlocks),
    JSON.stringify(steps),
    importantNotes,
    JSON.stringify(faqs),
    input.relatedSlugs ?? asStringArray(existing?.relatedSlugs),
    input.tags ?? asStringArray(existing?.tags),
    input.filterGroups ?? asStringArray(existing?.filterGroups),
    input.mediaIds ?? asStringArray(existing?.mediaIds),
    asText(input.videoUrl, existing?.videoUrl ?? "") || null,
    asText(input.videoTitle, existing?.videoTitle ?? "") || null,
    asText(input.seoTitle, existing?.seoTitle ?? title),
    asText(input.seoDescription, existing?.seoDescription ?? summary).slice(0, 220),
    readingMinutes,
    status,
    asBoolean(input.botTrainingEnabled, existing?.botTrainingEnabled ?? true),
    asBoolean(input.popular, existing?.popular ?? false),
    asBoolean(input.topSearched, existing?.topSearched ?? false),
    publishedAt,
  );

  await rebuildArticleChunks({
    id: articleId,
    role,
    slug,
    title,
    summary,
    intro,
    bodyBlocks,
    steps,
    importantNotes,
    faqs,
    tags: input.tags ?? asStringArray(existing?.tags),
    filterGroups: input.filterGroups ?? asStringArray(existing?.filterGroups),
  });

  if (options?.skipEnsure) {
    return null;
  }

  const saved = await getKnowledgeBaseArticle(role, slug, { includeDrafts: true });
  if (!saved) throw new Error("Knowledge base article could not be saved.");
  return saved;
}

async function rebuildArticleChunks(article: KnowledgeBaseArticleInput & { id: string; role: KnowledgeBaseRole; slug: string; title: string; summary: string }) {
  await prisma.$executeRawUnsafe(`DELETE FROM "KnowledgeBaseChunk" WHERE "articleId" = $1;`, article.id);
  const chunks = buildArticleChunks(article);
  for (const chunk of chunks) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "KnowledgeBaseChunk" ("id", "articleId", "role", "slug", "title", "content", "keywords")
      VALUES ($1, $2, $3, $4, $5, $6, $7::TEXT[]);
    `,
      chunk.id,
      article.id,
      article.role,
      article.slug,
      article.title,
      chunk.content,
      chunk.keywords,
    );
  }
}

export async function deleteKnowledgeBaseArticle(articleId: string) {
  await ensureKnowledgeBaseTables();
  await prisma.$executeRawUnsafe(`DELETE FROM "KnowledgeBaseChunk" WHERE "articleId" = $1;`, articleId);
  await prisma.$executeRawUnsafe(`DELETE FROM "KnowledgeBaseArticle" WHERE "id" = $1;`, articleId);
}

export async function saveKnowledgeBaseCategory(input: KnowledgeBaseCategoryInput) {
  await ensureKnowledgeBaseTables();
  const existing = input.id
    ? (
        await prisma.$queryRawUnsafe<CategoryRow[]>(`SELECT * FROM "KnowledgeBaseCategory" WHERE "id" = $1 LIMIT 1;`, input.id)
      )[0]
    : null;
  const role = normalizeRole(input.role, existing?.role ?? "PLATFORM");
  const title = asText(input.title, existing?.title ?? "New category");
  const slug = slugify(asText(input.slug, existing?.slug ?? title)) || makeId("category");
  const id = existing?.id ?? input.id ?? makeId("kb-cat");
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "KnowledgeBaseCategory" ("id", "role", "slug", "title", "description", "iconKey", "sortOrder", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "role" = EXCLUDED."role",
      "slug" = EXCLUDED."slug",
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "iconKey" = EXCLUDED."iconKey",
      "sortOrder" = EXCLUDED."sortOrder",
      "updatedAt" = CURRENT_TIMESTAMP;
    `,
    id,
    role,
    slug,
    title,
    asText(input.description, existing?.description ?? ""),
    asText(input.iconKey, existing?.iconKey ?? "book"),
    Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : existing?.sortOrder ?? 100,
  );
  return (await listKnowledgeBaseCategories()).find((category) => category.id === id) ?? null;
}

export async function deleteKnowledgeBaseCategory(categoryId: string) {
  await ensureKnowledgeBaseTables();
  await prisma.$executeRawUnsafe(`UPDATE "KnowledgeBaseArticle" SET "categoryId" = NULL WHERE "categoryId" = $1;`, categoryId);
  await prisma.$executeRawUnsafe(`DELETE FROM "KnowledgeBaseCategory" WHERE "id" = $1;`, categoryId);
}

export async function recordKnowledgeBaseFeedback(input: { articleId: string; helpful: boolean; comment?: string }) {
  await ensureKnowledgeBaseTables();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeBaseFeedback" ("id", "articleId", "helpful", "comment") VALUES ($1, $2, $3, $4);`,
    makeId("kb-feedback"),
    input.articleId,
    input.helpful,
    asText(input.comment) || null,
  );
}

async function ensureSupportBotSession(sessionId?: string | null) {
  const id = sessionId?.trim() || makeId("support-session");
  await ensureKnowledgeBaseTables()
    .then(() =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "SupportBotSession" ("id", "status") VALUES ($1, 'ACTIVE') ON CONFLICT ("id") DO NOTHING;`,
        id,
      ),
    )
    .catch(() => undefined);
  return id;
}

async function recordSupportBotMessage(input: { sessionId: string; role: "USER" | "ASSISTANT" | "SYSTEM"; body: string; sources?: unknown }) {
  await ensureKnowledgeBaseTables()
    .then(() =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "SupportBotMessage" ("id", "sessionId", "role", "body", "sources") VALUES ($1, $2, $3, $4, $5::jsonb);`,
        makeId("bot-msg"),
        input.sessionId,
        input.role,
        input.body,
        input.sources ? JSON.stringify(input.sources) : null,
      ),
    )
    .catch(() => undefined);
}

function isGreetingIntent(question: string) {
  const normalized = question.toLowerCase().replace(/[^a-z\s]/g, " ").trim();
  return /^(hi|hii|hello|hey|hey there|hello there|namaste|start|help)$/.test(normalized);
}

function isBusinessModelQuestion(question: string) {
  return /\b(business model|revenue model|commission model|profit|margin|how (do|does) (you|gigxomi) make money)\b/i.test(question);
}

function composeGreetingAnswer(role: KnowledgeBaseRole | null | undefined) {
  if (role === "AGENCY") {
    return "Hello, welcome to Gigxomi. How can I help you today? You can ask about posting work, hiring editors, reviewing applications, chat, project tracking, payments, or team workflow.";
  }

  if (role === "FREELANCER") {
    return "Hello, welcome to Gigxomi. How can I help you today? You can ask about profile setup, applying for work, chat, notifications, payments, withdrawals, or project workflow.";
  }

  return "Hello, welcome to Gigxomi. How can I help you today? You can ask how to book a service, find the right support article, use chat, check payments, or contact a human support member.";
}

function composeSupportBotAnswer(question: string, results: KnowledgeBaseSearchResult[]) {
  const top = results[0]?.article;
  if (!top || results[0].score < 2) {
    return {
      answer:
        "I could not find a confident answer in the Gigxomi knowledge base yet. I can still show related articles or connect you with the support team on WhatsApp.",
      needsHuman: true,
    };
  }

  const steps = top.steps.slice(0, 4).map((step, index) => `${index + 1}. ${step.title}: ${step.body}`);
  const notes = top.importantNotes.slice(0, 2).map((note) => `Note: ${note}`);
  const answer = [
    top.summary,
    steps.length ? `\nKey steps:\n${steps.join("\n")}` : "",
    notes.length ? `\n${notes.join("\n")}` : "",
    results.length > 1 ? `\nI also found related articles for ${results.slice(1, 3).map((result) => result.article.title).join(" and ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    answer,
    needsHuman: /\bhuman|support|agent|whatsapp|call|talk\b/i.test(question),
  };
}

export async function querySupportBot(input: { message: string; sessionId?: string | null; role?: KnowledgeBaseRole | null }) {
  const sessionId = await ensureSupportBotSession(input.sessionId);
  const message = asText(input.message);
  await recordSupportBotMessage({ sessionId, role: "USER", body: message });

  if (isBusinessModelQuestion(message)) {
    const answer = "I can help with using Gigxomi, booking a service, finding support articles, chat, payments, profiles, applications, and project updates. For company or commercial details, please contact the Gigxomi support team.";
    await recordSupportBotMessage({ sessionId, role: "ASSISTANT", body: answer, sources: [] });
    return {
      ok: true,
      sessionId,
      answer,
      needsHuman: true,
      sources: [],
    };
  }

  const greeting = isGreetingIntent(message);
  const query = greeting
    ? input.role === "AGENCY"
      ? "hire editors post work applications project tracking"
      : input.role === "FREELANCER"
        ? "apply for work profile setup payments chat"
        : "book service support chat payments"
    : message;
  const results = await searchKnowledgeBase({ query, role: input.role ?? null, limit: 4, recordEvent: true });
  const composed = greeting ? { answer: composeGreetingAnswer(input.role), needsHuman: false } : composeSupportBotAnswer(message, results);
  const sources = results.map((result) => ({
    href: result.article.href,
    role: result.article.role,
    slug: result.article.slug,
    summary: result.article.summary,
    title: result.article.title,
  }));
  await recordSupportBotMessage({ sessionId, role: "ASSISTANT", body: composed.answer, sources });
  return {
    ok: true,
    sessionId,
    answer: composed.answer,
    needsHuman: composed.needsHuman,
    sources,
  };
}

export async function handoffSupportBot(input: { sessionId?: string | null; name: string; phone: string; question: string }) {
  const sessionId = await ensureSupportBotSession(input.sessionId);
  const name = asText(input.name, "Gigxomi visitor");
  const phone = asText(input.phone, companyKnowledgeBase.supportPhoneE164);
  const question = asText(input.question, "Support request from Gigxomi knowledge base.");
  const result = await createManualConversationFromFile({
    role: "admin",
    customerName: name,
    customerPhone: phone,
  });
  await deliverConversationMessageFromFile(result.conversation.id, {
    role: "customer",
    lane: "customer",
    body: question,
    attachments: [],
  });
  await deliverConversationMessageFromFile(result.conversation.id, {
    role: "admin",
    lane: "internal",
    body: `Support bot handoff\nSession: ${sessionId}\nVisitor: ${name}\nPhone: ${phone}\nQuestion: ${question}`,
    attachments: [],
  });
  if (await canWriteKnowledgeBaseTelemetry()) {
    await prisma
      .$executeRawUnsafe(
        `UPDATE "SupportBotSession" SET "visitorName" = $1, "visitorPhone" = $2, "status" = 'HANDED_OFF', "handoffConversationId" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $4;`,
        name,
        phone,
        result.conversation.id,
        sessionId,
      )
      .catch(() => undefined);
  }
  const whatsappText = encodeURIComponent(`Hi Gigxomi Support, I need help.\n\nName: ${name}\nPhone: ${phone}\nQuestion: ${question}`);
  return {
    ok: true,
    sessionId,
    conversationId: result.conversation.id,
    adminChatHref: `/super-admin/chat?conversationId=${encodeURIComponent(result.conversation.id)}`,
    whatsappHref: `${companyKnowledgeBase.whatsappUrl}?text=${whatsappText}`,
  };
}

export async function buildKnowledgeBaseLlmText() {
  const articles = await listPublishedKnowledgeBaseArticles();
  const lines = [
    `# ${companyKnowledgeBase.brandName} Knowledge Base`,
    "",
    `> ${companyKnowledgeBase.businessDescription}`,
    "",
    "## Official URLs",
    `- Website: ${companyKnowledgeBase.siteUrl}`,
    `- About Gigxomi: ${buildSiteUrl(companyKnowledgeBase.aboutPath)}`,
    `- Pricing: ${buildSiteUrl("/pricing")}`,
    `- Agency Margin Calculator: ${buildSiteUrl("/tools/agency-margin-calculator")}`,
    `- Gigxomi vs Frame.io: ${buildSiteUrl("/vs/frame-io")}`,
    `- Gigxomi vs ClickUp: ${buildSiteUrl("/vs/clickup-for-video-agencies")}`,
    `- Knowledge Base: ${buildSiteUrl("/knowledge-base")}`,
    `- Blog: ${buildSiteUrl("/blog")}`,
    `- Contact: ${buildSiteUrl("/contact")}`,
    `- Android app: ${companyKnowledgeBase.playStoreUrl}`,
    "",
    "## Verified company facts",
    `- Brand: ${companyKnowledgeBase.brandName}`,
    `- Positioning: ${companyKnowledgeBase.tagline}`,
    `- Location: ${companyKnowledgeBase.location.locality}, ${companyKnowledgeBase.location.region}, India`,
    `- Support email: ${companyKnowledgeBase.contactEmail}`,
    `- Support phone: ${companyKnowledgeBase.supportPhoneE164}`,
    "- Audiences:",
    ...companyKnowledgeBase.audiences.map((audience) => `  - ${audience}`),
    "- Core services:",
    ...companyKnowledgeBase.coreServices.map((service) => `  - ${service}`),
    "- Official profiles:",
    ...companyKnowledgeBase.socialProfiles.map((profile) => `  - ${profile}`),
    "",
    "## Architectural pillars",
    "- Anti-Poaching Two-Lane Privacy: Clients communicate via WhatsApp or branded web portal without accessing editor personal contact information, shielding recurring retainers.",
    "- Flat ₹2,000/mo Subscription: Unlimited video editor and manager seats with zero per-seat tax or user-count penalties.",
    "- 0% Platform Commission: Agencies receive 100% of client payments directly into their bank account or UPI with zero marketplace deductions.",
    "- Native Frame-Accurate Video Review: Timecode comments, revision markers, and version comparison built directly into project cards.",
    "",
    "## Core workflow",
    "- Agencies post work.",
    "- Editors apply or accept invites.",
    "- Agencies review applications and accept suitable editors.",
    "- Chat unlocks after approval, with direct customer communication controlled by admin or manager permissions.",
    "- Workflows keep chats, project status, notifications, payments, and delivery context organized.",
    "",
    "## Published support articles",
  ];

  for (const article of articles) {
    lines.push("", `### ${article.title}`, `URL: ${buildKnowledgeBaseArticleUrl(article.role, article.slug)}`, `Role: ${article.role}`, `Summary: ${article.summary}`);
    if (article.steps.length) {
      lines.push("Steps:");
      article.steps.forEach((step, index) => lines.push(`${index + 1}. ${step.title}: ${step.body}`));
    }
    if (article.importantNotes.length) {
      lines.push("Important notes:");
      article.importantNotes.forEach((note) => lines.push(`- ${note}`));
    }
    if (article.faqs.length) {
      lines.push("FAQs:");
      article.faqs.forEach((faq) => lines.push(`- ${faq.question}: ${faq.answer}`));
    }
  }

  return `${lines.join("\n")}\n`;
}
