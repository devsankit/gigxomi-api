import { getPublicServiceSignals } from "@/lib/gigxomi/business-ecosystem-data";
import type { DummyPublicServiceCard, DummyServiceFaq, DummyServiceMedia } from "@/lib/gigxomi/dummy-platform-store";
import { getVideoPresentation } from "@/lib/gigxomi/media";
import { fetchWordPressServices } from "@/lib/gigxomi/wordpress";
import type { WordPressService } from "@/lib/gigxomi/types";

export type MarketplaceSurfaceService = DummyPublicServiceCard & {
  publicHref?: string;
  coverImageUrl?: string | null;
  sampleVideoUrl?: string | null;
  sampleThumbnailUrl?: string | null;
};

const accentPalette = [
  "linear-gradient(135deg, rgba(210, 255, 31, 0.18), rgba(10, 17, 24, 0.96))",
  "linear-gradient(135deg, rgba(210, 255, 31, 0.12), rgba(13, 20, 29, 0.96))",
  "linear-gradient(135deg, rgba(210, 255, 31, 0.08), rgba(17, 26, 36, 0.96))",
  "linear-gradient(135deg, rgba(210, 255, 31, 0.14), rgba(11, 18, 26, 0.96))",
];

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string) {
  return normalizeWhitespace(value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " "));
}

function ensureArray(value: string | string[] | null | undefined) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizeCategory(service: WordPressService): "Video Editing" | "Graphic Design" {
  const haystack = [
    ...ensureArray(service.category),
    ...ensureArray(service.freelancer.category),
    service.service_title,
    service.description,
    service.freelancer.skills.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (/(graphic|design|thumbnail|brand|poster|cover|logo)/i.test(haystack)) {
    return "Graphic Design";
  }

  return "Video Editing";
}

function getOwnerName(service: WordPressService) {
  return (
    service.freelancer.full_name ||
    service.freelancer.display_name ||
    [service.freelancer.first_name, service.freelancer.last_name].filter(Boolean).join(" ") ||
    service.freelancer.username ||
    "Gigxomi Freelancer"
  );
}

function buildSummary(service: WordPressService) {
  const description = stripHtml(service.description);
  if (description) {
    return description.slice(0, 170);
  }

  return `${service.service_title} by ${getOwnerName(service)}.`;
}

function buildDescription(service: WordPressService) {
  return stripHtml(service.description) || buildSummary(service);
}

function buildFaq(service: WordPressService): DummyServiceFaq[] {
  const source = [...(service.faq ?? []), ...(service.freelancer.faq ?? [])]
    .filter((item) => item.question && item.answer)
    .map((item) => ({
      question: stripHtml(item.question ?? ""),
      answer: stripHtml(item.answer ?? ""),
    }))
    .filter((item) => item.question && item.answer);

  if (source.length) {
    return source.slice(0, 4);
  }

  return [
    {
      question: "What do I need to share before the project starts?",
      answer: "Share your footage, brand notes, reference links, and delivery deadline so the editor can start smoothly.",
    },
    {
      question: "How does delivery happen on Gigxomi?",
      answer: "Delivery moves through Gigxomi review and approval before the final export is marked complete.",
    },
  ];
}

function buildDeliverables(service: WordPressService) {
  const deliverables = [
    ...service.addons,
    ...service.price_packages.flatMap((entry) => Object.values(entry).filter((value): value is string => typeof value === "string")),
  ]
    .map((value) => stripHtml(value))
    .filter(Boolean);

  if (deliverables.length) {
    return Array.from(new Set(deliverables)).slice(0, 5);
  }

  return ["Edited master export", "Platform-ready deliverable", "Gigxomi review support"];
}

function buildTags(service: WordPressService, category: "Video Editing" | "Graphic Design") {
  const tags = [
    ...ensureArray(service.category),
    ...ensureArray(service.freelancer.category),
    service.freelancer.english_level,
    service.freelancer.freelancer_type,
    ...service.freelancer.skills,
    category,
  ]
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);

  return Array.from(new Set(tags)).slice(0, 8);
}

function buildMedia(service: WordPressService): DummyServiceMedia[] {
  const galleryItems = Array.isArray(service.gallery) ? service.gallery : Object.values(service.gallery ?? {});
  const rawItems = [service.video_url, service.featured_image, ...galleryItems].filter(Boolean);

  if (!rawItems.length) {
    return [
      {
        id: `media-${service.service_id}-fallback`,
        kind: "image",
        title: service.service_title,
        accent: accentPalette[service.service_id % accentPalette.length]!,
      },
    ];
  }

  return rawItems.slice(0, 4).map((item, index) => ({
    id: `media-${service.service_id}-${index}`,
    kind: index === 0 && service.video_url ? "video" : "image",
    title: index === 0 && service.video_url ? `${service.service_title} sample` : `${service.service_title} preview ${index + 1}`,
    accent: accentPalette[(service.service_id + index) % accentPalette.length]!,
  }));
}

export function mapWordPressServiceToMarketplace(service: WordPressService): MarketplaceSurfaceService {
  const ownerName = getOwnerName(service);
  const ownerAlias = service.freelancer.username || ownerName;
  const category = normalizeCategory(service);
  const signals = getPublicServiceSignals(`${ownerAlias}-${service.service_title}-${service.service_id}`);
  const description = buildDescription(service);
  const tags = buildTags(service, category);
  const videoPresentation = getVideoPresentation(service.video_url);
  const coverImageUrl = service.featured_image || videoPresentation.thumbnail || null;

  return {
    id: `wp-service-${service.service_id}`,
    slug: service.service_slug || `service-${service.service_id}`,
    ownerId: `wp-user-${service.freelancer.user_id || service.freelancer.freelancer_post_id || service.service_id}`,
    ownerName,
    ownerAlias,
    title: normalizeWhitespace(service.service_title),
    summary: buildSummary(service),
    category,
    specialty: normalizeWhitespace(service.freelancer.title || service.service_title || category),
    description,
    targetAudience: normalizeWhitespace(service.freelancer.freelancer_type || service.freelancer.description || `${category} clients`),
    deliveryTime: normalizeWhitespace(service.delivery_time || "3 Days"),
    revisions: "2 revisions",
    basePrice: service.price && service.price > 0 ? service.price : 2500,
    currency: "INR",
    tags,
    seoTitle: normalizeWhitespace(service.service_title),
    seoDescription: description.slice(0, 155),
    seoKeywords: tags.slice(0, 6),
    deliverables: buildDeliverables(service),
    faq: buildFaq(service),
    media: buildMedia(service),
    status: "Approved",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trustBand: signals.trust,
    workloadBand: signals.workload,
    activeAgencySummary: signals.activeAgencySummary,
    turnaroundLabel: signals.turnaround,
    publicHref: `/services/${service.service_slug || `service-${service.service_id}`}`,
    coverImageUrl,
    sampleVideoUrl: service.video_url || undefined,
    sampleThumbnailUrl: videoPresentation.thumbnail || coverImageUrl,
  };
}

export function getMarketplaceCatalogStats(services: MarketplaceSurfaceService[]) {
  const owners = new Set(services.map((service) => service.ownerId));
  const videoOwners = new Set(services.filter((service) => service.category === "Video Editing").map((service) => service.ownerId));
  const designOwners = new Set(services.filter((service) => service.category === "Graphic Design").map((service) => service.ownerId));

  return {
    videoEditors: videoOwners.size,
    designEditors: designOwners.size,
    totalEditors: owners.size,
    totalServices: services.length,
  };
}

export async function loadMarketplaceDataFromWordPress() {
  const response = await fetchWordPressServices();
  const services = response.items.map(mapWordPressServiceToMarketplace);

  return {
    services,
    catalogStats: getMarketplaceCatalogStats(services),
  };
}

export async function getMarketplaceServiceBySlugFromWordPress(slug: string) {
  const response = await fetchWordPressServices();
  const service = response.items.find((item) => item.service_slug === slug);
  return service ? mapWordPressServiceToMarketplace(service) : null;
}
