import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { isEditorCategory } from "@/lib/gigxomi/freelancer-assessment-bank";
import { ensureFreelancerOnboarding, calculateFreelancerTrustScore } from "@/lib/gigxomi/freelancer-onboarding-service";
import { submitFreelancerServiceForReviewFromFile, upsertFreelancerServiceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { parsePlayablePortfolioUrl } from "@/lib/gigxomi/playable-portfolio-url";
import { prisma } from "@/lib/prisma";

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function list(value: unknown) { return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean); }

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const body = await request.json();
  const primaryCategory = text(body.primaryCategory);
  const secondaryCategories = list(body.secondaryCategories).filter((item) => item !== primaryCategory);
  const required = ["title", "summary", "description", "targetAudience", "deliveryTime", "revisions", "deliverables", "tags"]
    .filter((key) => (key === "deliverables" || key === "tags" ? list(body[key]).length === 0 : !text(body[key])));
  if (!isEditorCategory(primaryCategory)) required.push("primary editor category");
  if (secondaryCategories.length > 2 || secondaryCategories.some((item) => !isEditorCategory(item))) required.push("up to two valid secondary categories");
  const basePrice = Number(body.basePrice);
  if (!Number.isFinite(basePrice) || basePrice <= 0) required.push("base price");
  if (required.length) return NextResponse.json({ ok: false, error: `Complete these fields: ${[...new Set(required)].join(", ")}.` }, { status: 400 });

  const parsedPortfolio = parsePlayablePortfolioUrl(text(body.sampleVideoUrl));
  if (!parsedPortfolio.ok) {
    return NextResponse.json({ ok: false, error: parsedPortfolio.error }, { status: 400 });
  }

  const sampleVideoUrl = parsedPortfolio.normalizedUrl;
  const sampleVideoEmbedUrl = parsedPortfolio.embedUrl;

  const current = await ensureFreelancerOnboarding(authorization.session);
  const service = await upsertFreelancerServiceFromFile({
    id: current.service?.id,
    ownerId: authorization.session.userId,
    ownerName: authorization.session.displayName,
    ownerAlias: authorization.session.displayName,
    title: text(body.title), summary: text(body.summary), category: "Video Editing", specialty: primaryCategory,
    primaryEditorCategory: primaryCategory, secondaryEditorCategories: secondaryCategories,
    description: text(body.description), targetAudience: text(body.targetAudience), deliveryTime: text(body.deliveryTime),
    revisions: text(body.revisions), basePrice, tags: list(body.tags), seoTitle: text(body.seoTitle) || text(body.title),
    seoDescription: text(body.seoDescription) || text(body.summary), seoKeywords: list(body.seoKeywords).length ? list(body.seoKeywords) : list(body.tags),
    deliverables: list(body.deliverables), faq: [], sampleVideoUrl, sampleVideoEmbedUrl,
  });
  if (!service) return NextResponse.json({ ok: false, error: "Unable to save the service." }, { status: 500 });
  const submitted = await submitFreelancerServiceForReviewFromFile(service.id);
  const previousCount = await prisma.appFreelancerPortfolioReview.count({ where: { serviceId: service.id } });
  await prisma.$transaction([
    prisma.appFreelancerPortfolioReview.create({
      data: {
        id: `portfolio-${crypto.randomUUID()}`, serviceId: service.id, freelancerId: authorization.session.userId,
        submissionVersion: previousCount + 1, status: "PENDING", portfolioUrl: sampleVideoUrl,
      },
    }),
    prisma.appFreelancerOnboarding.upsert({
      where: { userId: authorization.session.userId },
      create: { userId: authorization.session.userId, currentStep: 3, serviceId: service.id, primaryCategory, secondaryCategories, serviceSubmittedAt: new Date() },
      update: { currentStep: 3, serviceId: service.id, primaryCategory, secondaryCategories, serviceSubmittedAt: new Date(), serviceDraft: Prisma.DbNull, status: "IN_PROGRESS", completedAt: null },
    }),
  ]);
  await calculateFreelancerTrustScore(authorization.session.userId);
  return NextResponse.json({ ok: true, service: submitted });
}
