import type { AppRole } from "@/lib/auth/types";

export type DeliveryAssetStatus =
  | "UPLOADED"
  | "PENDING_AGENCY_APPROVAL"
  | "AGENCY_APPROVED"
  | "AGENCY_REJECTED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "PUBLISH_FAILED";

export type ShowcaseApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type YouTubePublishStatus = "PENDING" | "UPLOADING" | "PUBLISHED" | "FAILED";
export type PortfolioDraftStatus = "LOCKED" | "READY" | "PUBLISHED" | "FAILED";
export type ShowcasePlacement = "PRIVATE_ONLY" | "FREELANCER_PROFILE" | "PUBLIC_SERVICE" | "AGENCY_SHOWCASE";
export type YouTubePrivacy = "private" | "unlisted" | "public";
export type PortfolioWorkScope = "SELF_SAMPLE" | "CLIENT_WORK";
export type PortfolioSourcePlatform = "YOUTUBE" | "INSTAGRAM" | "VIMEO" | "PINTEREST" | "OTHER" | "UNKNOWN";

export type DeliveryVersion = {
  id: string;
  assetId: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  downloadUrl: string;
  uploadedByRole: AppRole;
  uploadedByName: string;
  uploadedAt: string;
  note: string;
};

export type DeliveryAsset = {
  id: string;
  tenantId: string;
  conversationId: string;
  customerName: string;
  serviceTitle: string;
  assignedFreelancerId: string | null;
  assignedFreelancerName: string | null;
  status: DeliveryAssetStatus;
  latestVersionId: string;
  showcaseApprovalStatus: ShowcaseApprovalStatus;
  showcaseApprovalNote: string;
  showcaseApprovedAt: string | null;
  showcaseApprovedBy: string | null;
  youtubePublishJobId: string | null;
  portfolioDraftId: string | null;
  publishedVideoId: string | null;
  publishedVideoUrl: string | null;
  versions: DeliveryVersion[];
  createdAt: string;
  updatedAt: string;
};

export type YouTubePublishJob = {
  id: string;
  assetId: string;
  draftId: string;
  tenantId: string | null;
  conversationId: string;
  freelancerId: string | null;
  freelancerName: string | null;
  title: string;
  description: string;
  privacy: YouTubePrivacy;
  categoryId: string | null;
  tags: string[];
  madeForKids: boolean;
  status: YouTubePublishStatus;
  sourceFileName: string;
  sourceFilePath: string;
  sourceMimeType: string;
  sourceSizeBytes: number | null;
  videoId: string | null;
  videoUrl: string | null;
  error: string | null;
  retryCount: number;
  queuedAt: string;
  lastAttemptAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioDraft = {
  id: string;
  assetId: string;
  conversationId: string;
  tenantId: string;
  freelancerId: string | null;
  freelancerName: string | null;
  workScope: PortfolioWorkScope;
  status: PortfolioDraftStatus;
  agencyApprovalStatus: ShowcaseApprovalStatus;
  agencyApprovalNote: string;
  agencyApprovedAt: string | null;
  agencyApprovedBy: string | null;
  title: string;
  price: number | null;
  deliveryTime: string;
  category: string;
  summary: string;
  description: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  showcasePlacement: ShowcasePlacement;
  youtubeTitle: string;
  youtubeDescription: string;
  youtubePrivacy: YouTubePrivacy;
  youtubeCategoryId: string;
  youtubeTags: string[];
  audienceMadeForKids: boolean;
  sourceFileName: string;
  sourceDownloadUrl: string;
  sourceVideoPlatform: PortfolioSourcePlatform;
  sourceVideoEmbedUrl: string | null;
  sourceVideoId: string | null;
  sourceVideoUrl: string | null;
  publishRequestedAt: string | null;
  publishedAt: string | null;
  lastPublishError: string;
  createdAt: string;
  updatedAt: string;
};
