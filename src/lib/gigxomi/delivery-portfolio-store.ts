import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { AppRole } from "@/lib/auth/types";
import { listConversationsForAudienceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import type {
  DeliveryAsset,
  DeliveryVersion,
  PortfolioDraft,
  PortfolioDraftStatus,
  PortfolioSourcePlatform,
  PortfolioWorkScope,
  ShowcaseApprovalStatus,
  ShowcasePlacement,
  YouTubePublishJob,
  YouTubePrivacy,
} from "@/lib/gigxomi/delivery-portfolio-types";
import { listPlatformYouTubePublishJobs } from "@/lib/gigxomi/platform-youtube";

type DeliveryPortfolioStore = {
  deliveryAssets: DeliveryAsset[];
  portfolioDrafts: PortfolioDraft[];
  updatedAt: string;
};

type CreateDeliveryAssetInput = {
  conversationId: string;
  title?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  note?: string;
  uploadedByRole: AppRole;
  uploadedByName: string;
  fileBuffer: ArrayBuffer | Buffer;
};

type DeliveryApprovalInput = {
  approved: boolean;
  reviewedBy: string;
  note?: string;
};

type UpdatePortfolioDraftInput = {
  workScope?: PortfolioWorkScope;
  conversationId?: string;
  title?: string;
  price?: number | null;
  deliveryTime?: string;
  category?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
  showcasePlacement?: ShowcasePlacement;
  youtubeTitle?: string;
  youtubeDescription?: string;
  youtubePrivacy?: YouTubePrivacy;
  youtubeCategoryId?: string;
  youtubeTags?: string[];
  audienceMadeForKids?: boolean;
  sourceVideoPlatform?: PortfolioSourcePlatform;
  sourceVideoUrl?: string;
  sourceVideoEmbedUrl?: string | null;
};

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "delivery-portfolio-store.json");
const UPLOAD_DIRECTORY = path.join(STORE_DIRECTORY, "uploads", "delivery");

let queue = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function toBuffer(value: ArrayBuffer | Buffer) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function sanitizeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-");
}

function buildDownloadUrl(assetId: string) {
  return `/api/delivery/assets/${assetId}/file`;
}

function createEmptyStore(): DeliveryPortfolioStore {
  return {
    deliveryAssets: [],
    portfolioDrafts: [],
    updatedAt: nowIso(),
  };
}

function latestVersionForAsset(asset: DeliveryAsset) {
  return asset.versions.find((version) => version.id === asset.latestVersionId) ?? asset.versions.at(-1) ?? null;
}

function isDraftMetadataComplete(draft: PortfolioDraft) {
  return Boolean(
    draft.title.trim() &&
      draft.price &&
      draft.price > 0 &&
      draft.deliveryTime.trim() &&
      draft.category.trim() &&
      draft.summary.trim() &&
      draft.description.trim() &&
      draft.tags.length &&
      draft.seoTitle.trim() &&
      draft.seoDescription.trim() &&
      draft.youtubeTitle.trim() &&
      draft.youtubeDescription.trim(),
  );
}

function buildDraftStatus(draft: PortfolioDraft) {
  if (draft.sourceVideoUrl && (draft.agencyApprovalStatus === "APPROVED" || draft.workScope === "SELF_SAMPLE")) {
    return "PUBLISHED" as PortfolioDraftStatus;
  }

  if (draft.lastPublishError.trim()) {
    return "FAILED" as PortfolioDraftStatus;
  }

  return draft.agencyApprovalStatus === "APPROVED" ? "READY" : "LOCKED";
}

function buildPortfolioDraft(asset: DeliveryAsset, version: DeliveryVersion): PortfolioDraft {
  const timestamp = nowIso();
  return {
    id: makeId("portfolio-draft"),
    assetId: asset.id,
    conversationId: asset.conversationId,
    tenantId: asset.tenantId,
    freelancerId: asset.assignedFreelancerId,
    freelancerName: asset.assignedFreelancerName,
    workScope: "CLIENT_WORK",
    status: "LOCKED",
    agencyApprovalStatus: "PENDING",
    agencyApprovalNote: "",
    agencyApprovedAt: null,
    agencyApprovedBy: null,
    title: asset.serviceTitle,
    price: null,
    deliveryTime: "",
    category: "",
    summary: `Showcase draft for ${asset.customerName}.`,
    description: "",
    tags: [],
    seoTitle: "",
    seoDescription: "",
    showcasePlacement: "PRIVATE_ONLY",
    youtubeTitle: asset.serviceTitle,
    youtubeDescription: "",
    youtubePrivacy: "unlisted",
    youtubeCategoryId: "22",
    youtubeTags: [],
    audienceMadeForKids: false,
    sourceFileName: version.fileName,
    sourceDownloadUrl: version.downloadUrl,
    sourceVideoPlatform: "UNKNOWN",
    sourceVideoEmbedUrl: null,
    sourceVideoId: null,
    sourceVideoUrl: null,
    publishRequestedAt: null,
    publishedAt: null,
    lastPublishError: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function createSeedStore() {
  return createEmptyStore();
}

async function readStore() {
  try {
    const contents = await readFile(STORE_PATH, "utf8");
    return JSON.parse(contents) as DeliveryPortfolioStore;
  } catch {
    const seeded = await createSeedStore();
    await mkdir(STORE_DIRECTORY, { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(seeded, null, 2), "utf8");
    return seeded;
  }
}

async function writeStore(store: DeliveryPortfolioStore) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function withStore<T>(action: (store: DeliveryPortfolioStore) => Promise<T> | T, options?: { persist?: boolean }) {
  const run = async () => {
    const store = await readStore();
    const result = await action(store);
    if (options?.persist !== false) {
      store.updatedAt = nowIso();
      await writeStore(store);
    }
    return result;
  };

  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function findConversation(conversationId: string) {
  const { conversations } = await listConversationsForAudienceFromFile("admin");
  return conversations.find((conversation) => conversation.id === conversationId) ?? null;
}

async function saveUploadedFile(assetId: string, versionId: string, fileName: string, fileBuffer: ArrayBuffer | Buffer) {
  const sanitized = sanitizeFileName(fileName || "delivery-video.mp4");
  const directory = path.join(UPLOAD_DIRECTORY, assetId);
  const filePath = path.join(directory, `${versionId}-${sanitized}`);
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, toBuffer(fileBuffer));
  return filePath;
}

export function listDeliveryAssets() {
  return withStore((store) => [...store.deliveryAssets].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), {
    persist: false,
  });
}

export function getDeliveryAssetById(assetId: string) {
  return withStore((store) => store.deliveryAssets.find((asset) => asset.id === assetId) ?? null, { persist: false });
}

export function getDeliveryAssetLatestVersion(assetId: string) {
  return withStore((store) => {
    const asset = store.deliveryAssets.find((entry) => entry.id === assetId);
    if (!asset) {
      return null;
    }

    const version = latestVersionForAsset(asset);
    if (!version) {
      return null;
    }

    return {
      asset,
      version,
    };
  }, { persist: false });
}

export async function listPublishJobs() {
  const assets = await listDeliveryAssets();
  if (!assets.length) {
    return [] as YouTubePublishJob[];
  }
  return listPlatformYouTubePublishJobs({
    assetIds: assets.map((asset) => asset.id),
  });
}

export function listPortfolioDrafts() {
  return withStore((store) => [...store.portfolioDrafts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), {
    persist: false,
  });
}

export function listPublishedPortfolioDrafts(filters?: {
  tenantId?: string | null;
  freelancerId?: string | null;
  showcasePlacement?: ShowcasePlacement[];
}) {
  const allowedPlacements = filters?.showcasePlacement?.length ? new Set(filters.showcasePlacement) : null;

  return withStore(
    (store) =>
      store.portfolioDrafts
        .filter((draft) => {
          const approvalSatisfied = draft.workScope === "SELF_SAMPLE" || draft.agencyApprovalStatus === "APPROVED";
          if (!draft.sourceVideoUrl || !approvalSatisfied) {
            return false;
          }

          if (filters?.tenantId && draft.tenantId !== filters.tenantId) {
            return false;
          }

          if (filters?.freelancerId && draft.freelancerId !== filters.freelancerId) {
            return false;
          }

          if (allowedPlacements && !allowedPlacements.has(draft.showcasePlacement)) {
            return false;
          }

          return true;
        })
        .sort((left, right) => (right.publishedAt ?? right.updatedAt).localeCompare(left.publishedAt ?? left.updatedAt)),
    {
      persist: false,
    },
  );
}

export function getPortfolioDraftById(draftId: string) {
  return withStore((store) => store.portfolioDrafts.find((draft) => draft.id === draftId) ?? null, { persist: false });
}

export function getDraftPublishSource(draftId: string) {
  return withStore((store) => {
    const draft = store.portfolioDrafts.find((entry) => entry.id === draftId);
    if (!draft) {
      return null;
    }

    const asset = store.deliveryAssets.find((entry) => entry.id === draft.assetId);
    if (!asset) {
      return null;
    }

    const version = latestVersionForAsset(asset);
    if (!version) {
      return null;
    }

    return {
      draft,
      asset,
      version,
    };
  }, { persist: false });
}

export async function createDeliveryAsset(input: CreateDeliveryAssetInput) {
  const conversation = await findConversation(input.conversationId);
  if (!conversation) {
    return null;
  }

  return withStore(async (store) => {
    const timestamp = nowIso();
    const existingAsset = store.deliveryAssets.find((asset) => asset.conversationId === input.conversationId);
    const assetId = existingAsset?.id ?? makeId("delivery-asset");
    const versionId = makeId("delivery-version");
    const filePath = await saveUploadedFile(assetId, versionId, input.fileName, input.fileBuffer);

    const version: DeliveryVersion = {
      id: versionId,
      assetId,
      title: input.title?.trim() || `${conversation.serviceTitle} final delivery`,
      fileName: input.fileName.trim(),
      mimeType: input.mimeType?.trim() || "video/mp4",
      sizeBytes: input.sizeBytes ?? toBuffer(input.fileBuffer).byteLength,
      storagePath: filePath,
      downloadUrl: buildDownloadUrl(assetId),
      uploadedByRole: input.uploadedByRole,
      uploadedByName: input.uploadedByName,
      uploadedAt: timestamp,
      note: input.note?.trim() || "Final delivery uploaded directly into Gigxomi storage.",
    };

    if (existingAsset) {
      existingAsset.latestVersionId = version.id;
      existingAsset.versions.push(version);
      existingAsset.status = "PENDING_AGENCY_APPROVAL";
      existingAsset.showcaseApprovalStatus = "PENDING";
      existingAsset.showcaseApprovalNote = "";
      existingAsset.showcaseApprovedAt = null;
      existingAsset.showcaseApprovedBy = null;
      existingAsset.youtubePublishJobId = null;
      existingAsset.publishedVideoId = null;
      existingAsset.publishedVideoUrl = null;
      existingAsset.updatedAt = timestamp;

      const existingDraft = existingAsset.portfolioDraftId
        ? store.portfolioDrafts.find((draft) => draft.id === existingAsset.portfolioDraftId)
        : null;

      if (existingDraft) {
        existingDraft.status = "LOCKED";
        existingDraft.agencyApprovalStatus = "PENDING";
        existingDraft.agencyApprovalNote = "";
        existingDraft.agencyApprovedAt = null;
        existingDraft.agencyApprovedBy = null;
        existingDraft.sourceFileName = version.fileName;
        existingDraft.sourceDownloadUrl = version.downloadUrl;
        existingDraft.sourceVideoId = null;
        existingDraft.sourceVideoUrl = null;
        existingDraft.publishRequestedAt = null;
        existingDraft.publishedAt = null;
        existingDraft.lastPublishError = "";
        existingDraft.updatedAt = timestamp;
      } else {
        const draft = buildPortfolioDraft(existingAsset, version);
        existingAsset.portfolioDraftId = draft.id;
        store.portfolioDrafts.unshift(draft);
      }

      return existingAsset;
    }

    const asset: DeliveryAsset = {
      id: assetId,
      tenantId: "tenant-gigxomi",
      conversationId: conversation.id,
      customerName: conversation.customerDisplayName,
      serviceTitle: conversation.serviceTitle,
      assignedFreelancerId: conversation.assignedFreelancerId ?? null,
      assignedFreelancerName: conversation.assignedFreelancerName ?? null,
      status: "PENDING_AGENCY_APPROVAL",
      latestVersionId: version.id,
      showcaseApprovalStatus: "PENDING",
      showcaseApprovalNote: "",
      showcaseApprovedAt: null,
      showcaseApprovedBy: null,
      youtubePublishJobId: null,
      portfolioDraftId: null,
      publishedVideoId: null,
      publishedVideoUrl: null,
      versions: [version],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const draft = buildPortfolioDraft(asset, version);
    asset.portfolioDraftId = draft.id;

    store.deliveryAssets.unshift(asset);
    store.portfolioDrafts.unshift(draft);
    return asset;
  });
}

export async function createStandalonePortfolioDraft(input: {
  freelancerId: string;
  freelancerName: string;
  tenantId?: string | null;
  workScope?: PortfolioWorkScope;
  conversationId?: string;
}) {
  const timestamp = nowIso();
  const workScope = input.workScope ?? "SELF_SAMPLE";
  const conversation = input.conversationId ? await findConversation(input.conversationId) : null;

  return withStore((store) => {
    const draft: PortfolioDraft = {
      id: makeId("portfolio-draft"),
      assetId: "",
      conversationId: input.conversationId ?? "",
      tenantId: input.tenantId ?? "tenant-gigxomi",
      freelancerId: input.freelancerId,
      freelancerName: input.freelancerName,
      workScope,
      status: workScope === "SELF_SAMPLE" ? "READY" : "LOCKED",
      agencyApprovalStatus: workScope === "SELF_SAMPLE" ? "APPROVED" : "PENDING",
      agencyApprovalNote: workScope === "SELF_SAMPLE" ? "Self portfolio work can be published directly." : "",
      agencyApprovedAt: workScope === "SELF_SAMPLE" ? timestamp : null,
      agencyApprovedBy: workScope === "SELF_SAMPLE" ? input.freelancerName : null,
      title: conversation?.serviceTitle ?? "",
      price: null,
      deliveryTime: "",
      category: "",
      summary: "",
      description: "",
      tags: [],
      seoTitle: "",
      seoDescription: "",
      showcasePlacement: "FREELANCER_PROFILE",
      youtubeTitle: conversation?.serviceTitle ?? "",
      youtubeDescription: "",
      youtubePrivacy: "unlisted",
      youtubeCategoryId: "22",
      youtubeTags: [],
      audienceMadeForKids: false,
      sourceFileName: "",
      sourceDownloadUrl: "",
      sourceVideoPlatform: "UNKNOWN",
      sourceVideoEmbedUrl: null,
      sourceVideoId: null,
      sourceVideoUrl: null,
      publishRequestedAt: null,
      publishedAt: null,
      lastPublishError: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    store.portfolioDrafts.unshift(draft);
    return draft;
  });
}

export function refreshDeliveryReviewLink(assetId: string) {
  return getDeliveryAssetById(assetId);
}

export function recordDeliveryApproval(assetId: string, input: DeliveryApprovalInput) {
  return withStore((store) => {
    const asset = store.deliveryAssets.find((entry) => entry.id === assetId);
    if (!asset) {
      return null;
    }

    const draft = asset.portfolioDraftId ? store.portfolioDrafts.find((entry) => entry.id === asset.portfolioDraftId) ?? null : null;
    const timestamp = nowIso();
    const approvalStatus: ShowcaseApprovalStatus = input.approved ? "APPROVED" : "REJECTED";

    asset.showcaseApprovalStatus = approvalStatus;
    asset.showcaseApprovalNote = input.note?.trim() || (input.approved ? "Agency approved this work for showcase use." : "Agency declined showcase permission for this work.");
    asset.showcaseApprovedAt = input.approved ? timestamp : null;
    asset.showcaseApprovedBy = input.approved ? input.reviewedBy : null;
    asset.status = input.approved ? (asset.publishedVideoId ? "PUBLISHED" : "AGENCY_APPROVED") : "AGENCY_REJECTED";
    asset.updatedAt = timestamp;

    if (draft) {
      draft.agencyApprovalStatus = approvalStatus;
      draft.agencyApprovalNote = asset.showcaseApprovalNote;
      draft.agencyApprovedAt = asset.showcaseApprovedAt;
      draft.agencyApprovedBy = asset.showcaseApprovedBy;
      draft.status = input.approved ? (draft.sourceVideoId ? "PUBLISHED" : "READY") : "LOCKED";
      draft.updatedAt = timestamp;
    }

    return {
      asset,
      draft,
    };
  });
}

export function updatePortfolioDraft(draftId: string, input: UpdatePortfolioDraftInput) {
  return withStore((store) => {
    const draft = store.portfolioDrafts.find((entry) => entry.id === draftId);
    if (!draft) {
      return null;
    }

    if (typeof input.workScope !== "undefined") {
      draft.workScope = input.workScope;
      if (input.workScope === "SELF_SAMPLE") {
        draft.agencyApprovalStatus = "APPROVED";
        draft.agencyApprovalNote = draft.agencyApprovalNote || "Self portfolio work can be published directly.";
        draft.agencyApprovedAt = draft.agencyApprovedAt ?? nowIso();
        draft.agencyApprovedBy = draft.agencyApprovedBy ?? (draft.freelancerName || "Freelancer");
      } else if (draft.agencyApprovalStatus === "APPROVED" && draft.agencyApprovedBy === draft.freelancerName) {
        draft.agencyApprovalStatus = "PENDING";
        draft.agencyApprovalNote = "";
        draft.agencyApprovedAt = null;
        draft.agencyApprovedBy = null;
      }
    }
    if (typeof input.conversationId === "string") {
      draft.conversationId = input.conversationId.trim();
    }
    if (typeof input.title === "string") {
      draft.title = input.title.trim();
    }
    if (typeof input.price !== "undefined") {
      draft.price = input.price;
    }
    if (typeof input.deliveryTime === "string") {
      draft.deliveryTime = input.deliveryTime.trim();
    }
    if (typeof input.category === "string") {
      draft.category = input.category.trim();
    }
    if (typeof input.summary === "string") {
      draft.summary = input.summary.trim();
    }
    if (typeof input.description === "string") {
      draft.description = input.description.trim();
    }
    if (typeof input.tags !== "undefined") {
      draft.tags = input.tags.map((item) => item.trim()).filter(Boolean);
    }
    if (typeof input.seoTitle === "string") {
      draft.seoTitle = input.seoTitle.trim();
    }
    if (typeof input.seoDescription === "string") {
      draft.seoDescription = input.seoDescription.trim();
    }
    if (typeof input.showcasePlacement !== "undefined") {
      draft.showcasePlacement = input.showcasePlacement;
    }
    if (typeof input.youtubeTitle === "string") {
      draft.youtubeTitle = input.youtubeTitle.trim();
    }
    if (typeof input.youtubeDescription === "string") {
      draft.youtubeDescription = input.youtubeDescription.trim();
    }
    if (typeof input.youtubePrivacy !== "undefined") {
      draft.youtubePrivacy = input.youtubePrivacy;
    }
    if (typeof input.youtubeCategoryId === "string") {
      draft.youtubeCategoryId = input.youtubeCategoryId.trim();
    }
    if (typeof input.youtubeTags !== "undefined") {
      draft.youtubeTags = input.youtubeTags.map((item) => item.trim()).filter(Boolean);
    }
    if (typeof input.audienceMadeForKids === "boolean") {
      draft.audienceMadeForKids = input.audienceMadeForKids;
    }
    if (typeof input.sourceVideoPlatform !== "undefined") {
      draft.sourceVideoPlatform = input.sourceVideoPlatform;
    }
    if (typeof input.sourceVideoUrl === "string") {
      draft.sourceVideoUrl = input.sourceVideoUrl.trim();
    }
    if (typeof input.sourceVideoEmbedUrl !== "undefined") {
      draft.sourceVideoEmbedUrl = input.sourceVideoEmbedUrl;
    }

    draft.status = buildDraftStatus(draft);
    draft.updatedAt = nowIso();
    return draft;
  });
}

export function reviewPortfolioDraft(
  draftId: string,
  input: {
    approved: boolean;
    reviewedBy: string;
    note?: string;
  },
) {
  return withStore((store) => {
    const draft = store.portfolioDrafts.find((entry) => entry.id === draftId);
    if (!draft) {
      return null;
    }

    const timestamp = nowIso();
    draft.agencyApprovalStatus = input.approved ? "APPROVED" : "REJECTED";
    draft.agencyApprovalNote =
      input.note?.trim() ||
      (input.approved ? "Admin/manager approved this portfolio showcase." : "This portfolio showcase needs revision before it can go live.");
    draft.agencyApprovedAt = input.approved ? timestamp : null;
    draft.agencyApprovedBy = input.approved ? input.reviewedBy : null;
    draft.status = input.approved ? buildDraftStatus(draft) : "LOCKED";
    draft.updatedAt = timestamp;
    return draft;
  });
}

export function linkDraftPublishJob(draftId: string, publishJobId: string) {
  return withStore((store) => {
    const draft = store.portfolioDrafts.find((entry) => entry.id === draftId);
    if (!draft) {
      return null;
    }

    const asset = store.deliveryAssets.find((entry) => entry.id === draft.assetId) ?? null;
    const timestamp = nowIso();
    draft.publishRequestedAt = timestamp;
    draft.lastPublishError = "";
    draft.status = "READY";
    draft.updatedAt = timestamp;

    if (asset) {
      asset.youtubePublishJobId = publishJobId;
      asset.status = "PUBLISHING";
      asset.updatedAt = timestamp;
    }

    return {
      draft,
      asset,
    };
  });
}

export function markDraftPublished(
  draftId: string,
  input: {
    publishJobId: string;
    videoId: string;
    videoUrl: string;
    publishedAt: string;
    platform?: PortfolioSourcePlatform;
    embedUrl?: string | null;
  },
) {
  return withStore((store) => {
    const draft = store.portfolioDrafts.find((entry) => entry.id === draftId);
    if (!draft) {
      return null;
    }

    const asset = store.deliveryAssets.find((entry) => entry.id === draft.assetId) ?? null;
    draft.status = "PUBLISHED";
    if (input.platform) {
      draft.sourceVideoPlatform = input.platform;
    }
    if (typeof input.embedUrl !== "undefined") {
      draft.sourceVideoEmbedUrl = input.embedUrl;
    }
    draft.sourceVideoId = input.videoId;
    draft.sourceVideoUrl = input.videoUrl;
    draft.publishedAt = input.publishedAt;
    draft.lastPublishError = "";
    draft.updatedAt = input.publishedAt;

    if (asset) {
      asset.youtubePublishJobId = input.publishJobId;
      asset.publishedVideoId = input.videoId;
      asset.publishedVideoUrl = input.videoUrl;
      asset.status = "PUBLISHED";
      asset.updatedAt = input.publishedAt;
    }

    return {
      draft,
      asset,
    };
  });
}

export function markDraftPublishFailed(
  draftId: string,
  input: {
    publishJobId: string;
    error: string;
  },
) {
  return withStore((store) => {
    const draft = store.portfolioDrafts.find((entry) => entry.id === draftId);
    if (!draft) {
      return null;
    }

    const asset = store.deliveryAssets.find((entry) => entry.id === draft.assetId) ?? null;
    const timestamp = nowIso();
    draft.status = "FAILED";
    draft.lastPublishError = input.error;
    draft.updatedAt = timestamp;

    if (asset) {
      asset.youtubePublishJobId = input.publishJobId;
      asset.status = "PUBLISH_FAILED";
      asset.updatedAt = timestamp;
    }

    return {
      draft,
      asset,
    };
  });
}

export function getPortfolioDraftPublishReadiness(draft: PortfolioDraft) {
  return {
    metadataReady: isDraftMetadataComplete(draft),
    approvalReady: draft.agencyApprovalStatus === "APPROVED",
    canPublish: draft.agencyApprovalStatus === "APPROVED" && isDraftMetadataComplete(draft),
  };
}
