import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import {
  getServiceByIdFromFile,
  listAllServicesFromFile,
  reviewFreelancerServiceFromFile,
  submitFreelancerServiceForReviewFromFile,
  upsertFreelancerServiceFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { calculateFreelancerTrustScore } from "@/lib/gigxomi/freelancer-onboarding-service";
import { parsePlayablePortfolioUrl } from "@/lib/gigxomi/playable-portfolio-url";
import { prisma } from "@/lib/prisma";

type ServiceRecord = NonNullable<Awaited<ReturnType<typeof getServiceByIdFromFile>>>;
export type FreelancerServiceReviewAction = "APPROVE" | "REQUEST_CHANGES" | "REJECT";

function portfolioUrl(service: ServiceRecord) {
  const media = service.media.find((item) => item.sourceUrl?.trim() || item.embedUrl?.trim());
  return media?.sourceUrl?.trim() || media?.embedUrl?.trim() || "";
}

async function syncServiceToDirectory(service: ServiceRecord) {
  await prisma.appFreelancerService.upsert({
    where: { id: service.id },
    create: {
      id: service.id,
      slug: service.slug,
      ownerId: service.ownerId,
      ownerName: service.ownerName,
      ownerAlias: service.ownerAlias,
      status: service.status,
      payload: service as Prisma.InputJsonValue,
      createdAt: new Date(service.createdAt),
      updatedAt: new Date(service.updatedAt),
    },
    update: {
      slug: service.slug,
      ownerId: service.ownerId,
      ownerName: service.ownerName,
      ownerAlias: service.ownerAlias,
      status: service.status,
      payload: service as Prisma.InputJsonValue,
      updatedAt: new Date(service.updatedAt),
    },
  });
}

export function getFreelancerServiceSubmissionMissingFields(service: ServiceRecord | null) {
  if (!service) return ["service"];

  const missing: string[] = [];
  if (!service.title.trim()) missing.push("title");
  if (!service.summary.trim()) missing.push("summary");
  if (!service.specialty.trim()) missing.push("specialty");
  if (!service.description.trim()) missing.push("description");
  if (!service.targetAudience.trim()) missing.push("target audience");
  if (!service.deliveryTime.trim()) missing.push("delivery time");
  if (!service.revisions.trim()) missing.push("revision policy");
  if (!Number.isFinite(Number(service.basePrice)) || Number(service.basePrice) <= 0) missing.push("starting price");
  if (!service.tags.length) missing.push("tags/keywords");
  if (!service.deliverables.length) missing.push("deliverables");
  if (!parsePlayablePortfolioUrl(portfolioUrl(service)).ok) missing.push("portfolio video or website link");
  return missing;
}

export async function submitFreelancerServiceReview(input: { serviceId: string; freelancerId: string }) {
  const service = await getServiceByIdFromFile(input.serviceId);
  if (!service) return { ok: false as const, status: 404, error: "Service not found." };
  if (service.ownerId !== input.freelancerId) {
    return { ok: false as const, status: 403, error: "You do not have access to this service." };
  }

  const missingFields = getFreelancerServiceSubmissionMissingFields(service);
  if (missingFields.length) {
    return {
      ok: false as const,
      status: 400,
      error: `Complete these service fields before submitting: ${missingFields.join(", ")}.`,
      missingFields,
    };
  }

  const submittedService = await submitFreelancerServiceForReviewFromFile(service.id);
  if (!submittedService) return { ok: false as const, status: 404, error: "Service not found." };
  await syncServiceToDirectory(submittedService);

  const existingPendingReview = await prisma.appFreelancerPortfolioReview.findFirst({
    where: { serviceId: service.id, freelancerId: input.freelancerId, status: "PENDING" },
    orderBy: { submittedAt: "desc" },
  });
  const review = existingPendingReview ?? await prisma.appFreelancerPortfolioReview.create({
    data: {
      id: `service-review-${randomUUID()}`,
      serviceId: service.id,
      freelancerId: input.freelancerId,
      submissionVersion: (await prisma.appFreelancerPortfolioReview.count({ where: { serviceId: service.id } })) + 1,
      status: "PENDING",
      portfolioUrl: portfolioUrl(service),
    },
  });

  return { ok: true as const, service: submittedService, review };
}

export async function listFreelancerServiceReviews() {
  const [reviews, services] = await Promise.all([
    prisma.appFreelancerPortfolioReview.findMany({
      orderBy: { submittedAt: "desc" },
      take: 100,
      include: { freelancer: { select: { displayName: true, email: true, phone: true } } },
    }),
    listAllServicesFromFile(),
  ]);
  // Keep the database-backed mobile directory reconciled with the review store.
  // This also repairs older approvals that predate the directory mirror.
  await Promise.all(services.map((service) => syncServiceToDirectory(service)));
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const freelancerIds = Array.from(new Set(reviews.map((review) => review.freelancerId)));
  const [assessments, trustSnapshots] = await Promise.all([
    prisma.appFreelancerAssessment.findMany({ where: { userId: { in: freelancerIds } }, select: { userId: true, score: true } }),
    prisma.appFreelancerTrustSnapshot.findMany({ where: { userId: { in: freelancerIds } }, select: { userId: true, score: true, provisional: true } }),
  ]);
  const assessmentMap = new Map(assessments.map((item) => [item.userId, item.score]));
  const trustMap = new Map(trustSnapshots.map((item) => [item.userId, item]));

  return reviews.map((review) => ({
    ...review,
    service: serviceMap.get(review.serviceId) ?? null,
    assessmentScore: assessmentMap.get(review.freelancerId) ?? null,
    trust: trustMap.get(review.freelancerId) ?? null,
  }));
}

export async function decideFreelancerServiceReview(input: {
  reviewId: string;
  action: FreelancerServiceReviewAction;
  note?: string;
  reviewerId: string;
}) {
  const note = input.note?.trim() ?? "";
  if (input.action !== "APPROVE" && !note) {
    return { ok: false as const, status: 400, error: "Add clear reviewer feedback." };
  }

  const review = await prisma.appFreelancerPortfolioReview.findUnique({ where: { id: input.reviewId } });
  if (!review) return { ok: false as const, status: 404, error: "Service review was not found." };
  if (input.action === "APPROVE") {
    const playable = parsePlayablePortfolioUrl(review.portfolioUrl);
    if (!playable.ok) return { ok: false as const, status: 400, error: playable.error };
  }

  const service = await reviewFreelancerServiceFromFile(
    review.serviceId,
    input.action === "APPROVE" ? "approve" : "reject",
    note,
  );
  if (!service) return { ok: false as const, status: 404, error: "The submitted service was not found." };
  await syncServiceToDirectory(service);

  const status = input.action === "APPROVE" ? "APPROVED" : input.action === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "REJECTED";
  const updatedReview = await prisma.appFreelancerPortfolioReview.update({
    where: { id: review.id },
    data: {
      status,
      note: note || "Service approved for Gigxomi discovery.",
      reviewedByUserId: input.reviewerId,
      reviewedAt: new Date(),
    },
  });

  await calculateFreelancerTrustScore(review.freelancerId);
  await createAppNotification({
    userId: review.freelancerId,
    type: "service_review",
    title: input.action === "APPROVE" ? "Service approved" : input.action === "REQUEST_CHANGES" ? "Service changes requested" : "Service not approved",
    message: input.action === "APPROVE" ? "Your service is now eligible for agency discovery." : note,
    entityType: "service",
    entityId: review.serviceId,
  });
  return { ok: true as const, review: updatedReview, service };
}

export async function correctFreelancerServiceReview(input: {
  reviewId: string;
  reviewerId: string;
  patch: Record<string, unknown>;
}) {
  const review = await prisma.appFreelancerPortfolioReview.findUnique({ where: { id: input.reviewId } });
  if (!review) return { ok: false as const, status: 404, error: "Service review was not found." };
  const existing = await getServiceByIdFromFile(review.serviceId);
  if (!existing) return { ok: false as const, status: 404, error: "The submitted service was not found." };

  const nextPortfolioUrl = String(input.patch.portfolioUrl ?? portfolioUrl(existing)).trim();
  const playable = parsePlayablePortfolioUrl(nextPortfolioUrl);
  if (!playable.ok) return { ok: false as const, status: 400, error: playable.error };
  const text = (key: string, fallback: string) => typeof input.patch[key] === "string" ? String(input.patch[key]).trim() : fallback;
  const list = (key: string, fallback: string[]) => Array.isArray(input.patch[key])
    ? (input.patch[key] as unknown[]).map((item) => String(item).trim()).filter(Boolean)
    : fallback;
  const basePrice = Number(input.patch.basePrice ?? existing.basePrice);

  const corrected = await upsertFreelancerServiceFromFile({
    id: existing.id,
    ownerId: existing.ownerId,
    ownerName: existing.ownerName,
    ownerAlias: existing.ownerAlias,
    title: text("title", existing.title),
    summary: text("summary", existing.summary),
    category: "Video Editing",
    specialty: text("specialty", existing.specialty),
    primaryEditorCategory: text("primaryEditorCategory", existing.primaryEditorCategory ?? existing.specialty),
    secondaryEditorCategories: list("secondaryEditorCategories", existing.secondaryEditorCategories ?? []),
    description: text("description", existing.description),
    targetAudience: text("targetAudience", existing.targetAudience),
    deliveryTime: text("deliveryTime", existing.deliveryTime),
    revisions: text("revisions", existing.revisions),
    basePrice: Number.isFinite(basePrice) && basePrice > 0 ? basePrice : existing.basePrice,
    tags: list("tags", existing.tags),
    seoTitle: text("seoTitle", existing.seoTitle),
    seoDescription: text("seoDescription", existing.seoDescription),
    seoKeywords: list("seoKeywords", existing.seoKeywords),
    deliverables: list("deliverables", existing.deliverables),
    faq: existing.faq,
    sampleVideoUrl: playable.normalizedUrl,
    sampleVideoEmbedUrl: playable.embedUrl,
  });
  if (!corrected) return { ok: false as const, status: 500, error: "Unable to save the corrected service." };

  await syncServiceToDirectory(corrected);
  const updatedReview = await prisma.appFreelancerPortfolioReview.update({
    where: { id: review.id },
    data: { portfolioUrl: playable.normalizedUrl, note: `Details corrected by Super Admin ${input.reviewerId}.` },
  });
  return { ok: true as const, review: updatedReview, service: corrected };
}
