import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { SessionContext } from "@/lib/auth/session";
import { getFreelancerWorkspaceState, type FreelancerProfileRecord } from "@/lib/gigxomi/freelancer-workspace-store";
import { listFreelancerServicesFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import {
  assignAssessmentQuestions,
  EDITOR_CATEGORIES,
  getAssessmentQuestion,
  isEditorCategory,
} from "@/lib/gigxomi/freelancer-assessment-bank";
import { hasDigiLockerProviderConfiguration } from "@/lib/gigxomi/digilocker-config";
import { prisma } from "@/lib/prisma";

export const FREELANCER_ONBOARDING_VERSION = 1;
export const TRUST_CALCULATION_VERSION = 2;

type FreelancerSession = Pick<SessionContext, "userId" | "displayName" | "email" | "phone" | "role"> & { userId: string };

function makeId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function profileIsComplete(profile: FreelancerProfileRecord) {
  return Boolean(
    profile.fullName.trim() &&
      profile.displayName.trim() &&
      profile.profileImageUrl.trim() &&
      profile.bio.trim() &&
      profile.experience.trim() &&
      profile.languages.length &&
      profile.location.trim() &&
      profile.timezone.trim() &&
      profile.availability.trim() &&
      profile.profession.trim(),
  );
}

function publicIdentity(identity: Awaited<ReturnType<typeof prisma.appFreelancerIdentity.findUnique>>) {
  if (!identity) {
    return { status: "NOT_STARTED", verified: false, skipped: false, verifiedName: null, documentType: null, issuer: null };
  }
  return {
    status: identity.status,
    verified: identity.status === "VERIFIED",
    skipped: identity.status === "SKIPPED",
    verifiedName: identity.verifiedName,
    documentType: identity.documentType,
    issuer: identity.issuer,
  };
}

function safeQuestion(questionId: string) {
  const question = getAssessmentQuestion(questionId);
  if (!question) return null;
  return {
    id: question.id,
    competency: question.competency,
    prompt: question.prompt,
    options: question.options.map(({ id, label }) => ({ id, label })),
  };
}

function getServiceCategories(service: { primaryEditorCategory?: string; secondaryEditorCategories?: string[]; specialty?: string } | null) {
  const primary = isEditorCategory(service?.primaryEditorCategory)
    ? service.primaryEditorCategory
    : isEditorCategory(service?.specialty)
      ? service.specialty
      : null;
  const secondary = Array.isArray(service?.secondaryEditorCategories)
    ? service.secondaryEditorCategories.filter(isEditorCategory).filter((item) => item !== primary).slice(0, 2)
    : [];
  return { primary, secondary };
}

export function isFreelancerOnboardingEnabled() {
  return true;
}

export async function ensureFreelancerOnboarding(session: FreelancerSession) {
  const userId = session.userId;
  const [workspace, services, assessment, identity, stored, latestPortfolioReview] = await Promise.all([
    getFreelancerWorkspaceState(userId, session),
    listFreelancerServicesFromFile(userId),
    prisma.appFreelancerAssessment.findUnique({ where: { userId } }),
    prisma.appFreelancerIdentity.findUnique({ where: { userId } }),
    prisma.appFreelancerOnboarding.findUnique({ where: { userId } }),
    prisma.appFreelancerPortfolioReview.findFirst({ where: { freelancerId: userId }, orderBy: { submittedAt: "desc" } }),
  ]);

  const submittedService = services.find((service) => ["Pending Review", "Approved", "Rejected"].includes(service.status)) ?? null;
  let editableService = submittedService ?? services[0] ?? null;
  if (!editableService && latestPortfolioReview) {
    const persistedService = await prisma.appFreelancerService.findUnique({ where: { id: latestPortfolioReview.serviceId }, select: { payload: true } });
    if (persistedService?.payload && typeof persistedService.payload === "object" && !Array.isArray(persistedService.payload)) {
      editableService = persistedService.payload as unknown as (typeof services)[number];
    }
  }
  const serviceSubmitted = Boolean(submittedService || latestPortfolioReview || stored?.serviceSubmittedAt);
  const assessmentSubmitted = Boolean(assessment?.submittedAt && assessment.score !== null);
  const profileCompleted = profileIsComplete(workspace.profile);
  const identityChosen = identity?.status === "VERIFIED" || identity?.status === "SKIPPED";
  const completed = stored?.status === "SKIPPED" || (serviceSubmitted && assessmentSubmitted && profileCompleted && identityChosen);
  const currentStep = !profileCompleted || !identityChosen ? 1 : !serviceSubmitted ? 2 : !assessmentSubmitted ? 3 : 3;
  const categoriesFromService = getServiceCategories(editableService);
  const categories = {
    primary: categoriesFromService.primary ?? stored?.primaryCategory ?? null,
    secondary: categoriesFromService.secondary.length ? categoriesFromService.secondary : stored?.secondaryCategories ?? [],
  };
  const submittedAt = stored?.serviceSubmittedAt ?? latestPortfolioReview?.submittedAt ?? (submittedService ? new Date(submittedService.updatedAt) : null);
  const now = new Date();

  const onboarding = await prisma.appFreelancerOnboarding.upsert({
    where: { userId },
    create: {
      userId,
      version: FREELANCER_ONBOARDING_VERSION,
      status: completed ? "COMPLETED" : "IN_PROGRESS",
      currentStep,
      serviceId: editableService?.id ?? latestPortfolioReview?.serviceId ?? null,
      primaryCategory: categories.primary,
      secondaryCategories: categories.secondary,
      serviceSubmittedAt: serviceSubmitted ? submittedAt : null,
      profileCompletedAt: profileCompleted ? now : null,
      identityChoiceAt: identityChosen ? identity?.verifiedAt ?? identity?.skippedAt ?? now : null,
      completedAt: completed ? now : null,
    },
    update: {
      version: FREELANCER_ONBOARDING_VERSION,
      status: completed ? "COMPLETED" : "IN_PROGRESS",
      currentStep,
      serviceId: editableService?.id ?? latestPortfolioReview?.serviceId ?? stored?.serviceId ?? null,
      primaryCategory: categories.primary ?? stored?.primaryCategory ?? null,
      secondaryCategories: categories.secondary.length ? categories.secondary : stored?.secondaryCategories ?? [],
      serviceSubmittedAt: serviceSubmitted ? submittedAt : null,
      profileCompletedAt: profileCompleted ? stored?.profileCompletedAt ?? now : null,
      identityChoiceAt: identityChosen ? stored?.identityChoiceAt ?? identity?.verifiedAt ?? identity?.skippedAt ?? now : null,
      completedAt: completed ? stored?.completedAt ?? now : null,
    },
  });

  return { onboarding, workspace, services, service: editableService, assessment, identity, completed };
}

export async function getFreelancerOnboardingState(session: FreelancerSession) {
  let state = await ensureFreelancerOnboarding(session);
  if (state.onboarding.serviceSubmittedAt && !state.assessment && isEditorCategory(state.onboarding.primaryCategory)) {
    await assignFreelancerAssessment(session.userId, state.onboarding.primaryCategory);
    state = await ensureFreelancerOnboarding(session);
  }
  const trust = await calculateFreelancerTrustScore(session.userId);
  return {
    version: state.onboarding.version,
    status: state.onboarding.status,
    currentStep: state.onboarding.currentStep,
    completed: state.completed,
    skipped: state.onboarding.status === "SKIPPED",
    categories: EDITOR_CATEGORIES,
    selectedCategories: {
      primary: state.onboarding.primaryCategory,
      secondary: state.onboarding.secondaryCategories,
    },
    service: state.service,
    assessment: state.assessment
      ? {
          submitted: Boolean(state.assessment.submittedAt),
          score: state.assessment.submittedAt ? state.assessment.score : null,
          questions: state.assessment.questionIds.map(safeQuestion).filter(Boolean),
        }
      : { submitted: false, score: null, questions: [] },
    profile: state.workspace.profile,
    drafts: {
      service: metadataObject(state.onboarding.serviceDraft),
      profile: metadataObject(state.onboarding.profileDraft),
      answers: !state.assessment?.submittedAt ? metadataObject(state.assessment?.answers ?? {}) : {},
    },
    identity: publicIdentity(state.identity),
    trust,
  };
}

export async function assignFreelancerAssessment(userId: string, categoryInput: unknown) {
  const onboarding = await prisma.appFreelancerOnboarding.findUnique({ where: { userId } });
  const category = isEditorCategory(categoryInput) ? categoryInput : onboarding?.primaryCategory;
  if (!isEditorCategory(category)) {
    return { ok: false as const, status: 409, error: "Submit your service and primary editor category first." };
  }

  let assessment = await prisma.appFreelancerAssessment.findUnique({ where: { userId } });
  if (!assessment) {
    const questions = assignAssessmentQuestions(userId, category, FREELANCER_ONBOARDING_VERSION);
    assessment = await prisma.appFreelancerAssessment.create({
      data: {
        id: makeId("assessment"),
        userId,
        version: FREELANCER_ONBOARDING_VERSION,
        primaryCategory: category,
        questionIds: questions.map((item) => item.id),
        answers: {},
      },
    });
  }

  return {
    ok: true as const,
    assessment: {
      submitted: Boolean(assessment.submittedAt),
      score: assessment.submittedAt ? assessment.score : null,
      questions: assessment.questionIds.map(safeQuestion).filter(Boolean),
    },
  };
}

export async function submitFreelancerAssessment(userId: string, answersInput: unknown) {
  const assessment = await prisma.appFreelancerAssessment.findUnique({ where: { userId } });
  if (!assessment) return { ok: false as const, status: 404, error: "Assessment was not assigned." };
  if (assessment.submittedAt) return { ok: false as const, status: 409, error: "This assessment has already been submitted." };
  const answers = typeof answersInput === "object" && answersInput ? (answersInput as Record<string, unknown>) : {};
  if (assessment.questionIds.some((questionId) => typeof answers[questionId] !== "string")) {
    return { ok: false as const, status: 400, error: "Answer all ten questions before submitting." };
  }

  let score = 0;
  const normalizedAnswers: Record<string, string> = {};
  for (const questionId of assessment.questionIds) {
    const question = getAssessmentQuestion(questionId);
    const optionId = String(answers[questionId]);
    const option = question?.options.find((item) => item.id === optionId);
    if (!question || !option) return { ok: false as const, status: 400, error: "One or more answers are invalid." };
    normalizedAnswers[questionId] = optionId;
    score += option.points;
  }

  await prisma.appFreelancerAssessment.update({
    where: { userId },
    data: { answers: normalizedAnswers, score: clamp(score, 0, 20), submittedAt: new Date() },
  });
  await calculateFreelancerTrustScore(userId);
  return { ok: true as const, score: clamp(score, 0, 20) };
}

function metadataObject(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === "object" && value && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function responseAtForAssignment(assignment: { metadata: Prisma.JsonValue; acceptedAt: Date | null }) {
  const responseAt = metadataObject(assignment.metadata).freelancerResponseAt;
  const parsed = typeof responseAt === "string" ? new Date(responseAt) : assignment.acceptedAt;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function ratingForAssignment(assignment: { metadata: Prisma.JsonValue }) {
  const rating = Number(metadataObject(assignment.metadata).agencyRating ?? 0);
  return Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

function componentMap(snapshot: Awaited<ReturnType<typeof prisma.appFreelancerTrustSnapshot.findUnique>>) {
  return snapshot
    ? {
        ASSESSMENT: snapshot.assessmentPoints,
        PROFILE: snapshot.profilePoints,
        PORTFOLIO: snapshot.portfolioPoints,
        IDENTITY: snapshot.identityPoints,
        RELIABILITY: snapshot.reliabilityPoints,
        ON_TIME: snapshot.onTimePoints,
        RESPONSE: snapshot.responsePoints,
        UPDATES: snapshot.updatePoints,
        RATING: snapshot.ratingPoints,
      }
    : {};
}

export async function calculateFreelancerTrustScore(userId: string) {
  const [assessment, onboarding, identity, assignments, previous, scoreDisputes, agencyRatings, configuredRules] = await Promise.all([
    prisma.appFreelancerAssessment.findUnique({ where: { userId } }),
    prisma.appFreelancerOnboarding.findUnique({ where: { userId } }),
    prisma.appFreelancerIdentity.findUnique({ where: { userId } }),
    prisma.appAssignmentRecord.findMany({ where: { freelancerId: userId }, orderBy: { createdAt: "desc" }, take: 20, include: { progressUpdates: true, performanceContext: true } }),
    prisma.appFreelancerTrustSnapshot.findUnique({ where: { userId } }),
    prisma.appFreelancerTrustDispute.findMany({ where: { userId, status: { in: ["OPEN", "RESTORED"] } }, include: { event: true } }),
    prisma.appFreelancerRating.findMany({ where: { freelancerId: userId }, select: { score: true } }),
    prisma.appTrustScoreRule.findMany({ where: { isActive: true } }),
  ]);
  const included = assignments.filter((item) => !item.performanceContext?.excludedFromPerformance);
  const completed = included.filter((item) => item.status === "COMPLETED");
  const responded = included.map((item) => ({ assignment: item, respondedAt: responseAtForAssignment(item) })).filter((item) => item.respondedAt);
  const terminalAssignments = included.filter((item) => {
    if (item.status === "COMPLETED") return true;
    if (item.status !== "CANCELLED") return false;
    return String(metadataObject(item.metadata).freelancerResponse ?? "").toUpperCase() !== "DECLINE";
  });
  const completionRatio = terminalAssignments.length ? completed.length / terminalAssignments.length : 0;
  const capacityPoints = Math.min(5, completed.length);
  const reliabilityPoints = clamp(completionRatio * 10 + capacityPoints, 0, 15);
  const onTimeEligible = completed.filter((item) => {
    const attribution = item.performanceContext?.delayAttribution?.toUpperCase();
    return attribution !== "AGENCY" && attribution !== "CLIENT" && (item.performanceContext?.effectiveDeadline ?? item.deadline) && item.submittedAt;
  });
  const onTimeRatio = onTimeEligible.length ? onTimeEligible.filter((item) => item.submittedAt! <= (item.performanceContext?.effectiveDeadline ?? item.deadline)!).length / onTimeEligible.length : 0;
  const onTimePoints = clamp(onTimeRatio * 15, 0, 15);
  const responseMinutes = responded.map((item) => (item.respondedAt!.getTime() - item.assignment.createdAt.getTime()) / 60_000).filter((value) => value >= 0);
  const averageResponse = responseMinutes.length ? responseMinutes.reduce((sum, value) => sum + value, 0) / responseMinutes.length : null;
  const responsePoints = averageResponse === null ? 0 : averageResponse <= 30 ? 10 : averageResponse <= 120 ? 7 : averageResponse <= 480 ? 4 : 1;
  const updateEligible = included.filter((item) => ["ACCEPTED", "IN_PROGRESS", "SUBMITTED", "COMPLETED", "REVISION_REQUESTED"].includes(item.status));
  const updatePoints = updateEligible.length ? clamp((updateEligible.filter((item) => item.progressUpdates.length > 0).length / updateEligible.length) * 10, 0, 10) : 0;
  const ratings = [
    ...completed.map(ratingForAssignment).filter((value): value is number => value !== null),
    ...agencyRatings.map((item) => item.score),
  ];
  const ratingPoints = ratings.length ? clamp((ratings.reduce((sum, value) => sum + value, 0) / ratings.length / 5) * 10, 0, 10) : 0;
  const assessmentPoints = clamp(assessment?.score ?? 0, 0, 20);
  const profilePoints = onboarding?.profileCompletedAt ? 5 : 0;
  const latestReview = onboarding?.serviceId ? await prisma.appFreelancerPortfolioReview.findFirst({ where: { serviceId: onboarding.serviceId }, orderBy: { submittedAt: "desc" } }) : null;
  const portfolioPoints = latestReview?.status === "APPROVED" ? 10 : 0;
  const identityPoints = identity?.status === "VERIFIED" ? 5 : 0;
  const frozenAdjustments = scoreDisputes.reduce<Record<string, number>>((result, item) => {
    if (item.event.delta < 0) result[item.event.component] = (result[item.event.component] ?? 0) + Math.abs(item.event.delta);
    return result;
  }, {});
  const defaultWeights = { ASSESSMENT: 20, PROFILE: 5, PORTFOLIO: 10, IDENTITY: 5, RELIABILITY: 15, ON_TIME: 15, RESPONSE: 10, UPDATES: 10, RATING: 10 };
  const weights = configuredRules.reduce((result, rule) => {
    if (rule.key in result) result[rule.key as keyof typeof result] = clamp(rule.weight, 0, 100);
    return result;
  }, { ...defaultWeights });
  const scale = (value: number, defaultMax: number, key: keyof typeof weights) => clamp((value / defaultMax) * weights[key], 0, weights[key]);
  const adjustedReliabilityPoints = clamp(scale(reliabilityPoints, 15, "RELIABILITY") + (frozenAdjustments.RELIABILITY ?? 0), 0, weights.RELIABILITY);
  const adjustedOnTimePoints = clamp(scale(onTimePoints, 15, "ON_TIME") + (frozenAdjustments.ON_TIME ?? 0), 0, weights.ON_TIME);
  const adjustedResponsePoints = clamp(scale(responsePoints, 10, "RESPONSE") + (frozenAdjustments.RESPONSE ?? 0), 0, weights.RESPONSE);
  const adjustedUpdatePoints = clamp(scale(updatePoints, 10, "UPDATES") + (frozenAdjustments.UPDATES ?? 0), 0, weights.UPDATES);
  const adjustedRatingPoints = clamp(scale(ratingPoints, 10, "RATING") + (frozenAdjustments.RATING ?? 0), 0, weights.RATING);
  const adjustedAssessmentPoints = clamp(scale(assessmentPoints, 20, "ASSESSMENT") + (frozenAdjustments.ASSESSMENT ?? 0), 0, weights.ASSESSMENT);
  const adjustedProfilePoints = clamp(scale(profilePoints, 5, "PROFILE") + (frozenAdjustments.PROFILE ?? 0), 0, weights.PROFILE);
  const adjustedPortfolioPoints = clamp(scale(portfolioPoints, 10, "PORTFOLIO") + (frozenAdjustments.PORTFOLIO ?? 0), 0, weights.PORTFOLIO);
  const adjustedIdentityPoints = clamp(scale(identityPoints, 5, "IDENTITY") + (frozenAdjustments.IDENTITY ?? 0), 0, weights.IDENTITY);
  const weightedTotal = adjustedAssessmentPoints + adjustedProfilePoints + adjustedPortfolioPoints + adjustedIdentityPoints + adjustedReliabilityPoints + adjustedOnTimePoints + adjustedResponsePoints + adjustedUpdatePoints + adjustedRatingPoints;
  const totalWeight = Math.max(1, Object.values(weights).reduce((sum, value) => sum + value, 0));
  const score = clamp((weightedTotal / totalWeight) * 100, 0, 100);
  const nextAction = !onboarding?.profileCompletedAt
    ? "COMPLETE_PROFILE"
    : !onboarding?.serviceSubmittedAt
      ? "COMPLETE_SERVICE"
      : !assessment?.submittedAt
        ? "COMPLETE_ASSESSMENT"
        : latestReview?.status === "CHANGES_REQUESTED" || latestReview?.status === "REJECTED"
          ? "REVISE_PORTFOLIO"
          : hasDigiLockerProviderConfiguration() && identity?.status !== "VERIFIED" && identity?.status !== "SKIPPED"
            ? "VERIFY_IDENTITY"
            : included.some((item) => item.status === "ASSIGNED")
              ? "RESPOND_TO_ASSIGNMENT"
              : included.some((item) => ["ACCEPTED", "IN_PROGRESS", "REVISION_REQUESTED"].includes(item.status) && item.progressUpdates.length === 0)
                ? "POST_PROGRESS_UPDATE"
                : completed.length < 3
                  ? "COMPLETE_RELIABLE_WORK"
                  : null;

  const data = {
    score,
    provisional: completed.length < 3,
    assessmentPoints: adjustedAssessmentPoints,
    profilePoints: adjustedProfilePoints,
    portfolioPoints: adjustedPortfolioPoints,
    identityPoints: adjustedIdentityPoints,
    reliabilityPoints: adjustedReliabilityPoints,
    onTimePoints: adjustedOnTimePoints,
    responsePoints: adjustedResponsePoints,
    updatePoints: adjustedUpdatePoints,
    ratingPoints: adjustedRatingPoints,
    completedAssignments: completed.length,
    nextAction,
    calculationVersion: TRUST_CALCULATION_VERSION,
    calculatedAt: new Date(),
  };
  const snapshot = await prisma.appFreelancerTrustSnapshot.upsert({ where: { userId }, create: { userId, ...data }, update: data });

  const before = componentMap(previous);
  const after = componentMap(snapshot);
  for (const [component, points] of Object.entries(after)) {
    const delta = points - (before[component as keyof typeof before] ?? 0);
    if (!delta) continue;
    await prisma.appFreelancerTrustEvent.create({
      data: {
        id: makeId("trust"), userId, component, delta, scoreAfter: score,
        reason: `${component.replaceAll("_", " ").toLowerCase()} contribution ${delta > 0 ? "increased" : "decreased"}.`,
        sourceType: "TRUST_RECALCULATION", sourceId: null,
      },
    });
  }

  return {
    score: snapshot.score,
    provisional: snapshot.provisional,
    completedAssignments: snapshot.completedAssignments,
    nextAction: snapshot.nextAction,
    components: {
      assessment: { points: snapshot.assessmentPoints, max: weights.ASSESSMENT }, profile: { points: snapshot.profilePoints, max: weights.PROFILE },
      portfolio: { points: snapshot.portfolioPoints, max: weights.PORTFOLIO }, identity: { points: snapshot.identityPoints, max: weights.IDENTITY },
      reliability: { points: snapshot.reliabilityPoints, max: weights.RELIABILITY }, onTime: { points: snapshot.onTimePoints, max: weights.ON_TIME },
      response: { points: snapshot.responsePoints, max: weights.RESPONSE }, updates: { points: snapshot.updatePoints, max: weights.UPDATES }, rating: { points: snapshot.ratingPoints, max: weights.RATING },
    },
  };
}

export async function listFreelancerTrustHistory(userId: string) {
  const [snapshot, events, onboarding] = await Promise.all([
    calculateFreelancerTrustScore(userId),
    prisma.appFreelancerTrustEvent.findMany({ where: { userId }, orderBy: { occurredAt: "desc" }, take: 50, include: { dispute: true } }),
    prisma.appFreelancerOnboarding.findUnique({ where: { userId }, select: { campaignOptOut: true } }),
  ]);
  return { snapshot, events, preferences: { trustImprovementNotifications: !onboarding?.campaignOptOut } };
}

export async function createTrustDispute(userId: string, eventId: string, reason: string) {
  const event = await prisma.appFreelancerTrustEvent.findFirst({ where: { id: eventId, userId } });
  if (!event) return { ok: false as const, status: 404, error: "Trust event was not found." };
  if (event.delta >= 0) return { ok: false as const, status: 400, error: "Only a negative Trust Score change can be disputed." };
  if (!reason.trim()) return { ok: false as const, status: 400, error: "Explain why this score change should be reviewed." };
  const dispute = await prisma.$transaction(async (transaction) => {
    await transaction.appFreelancerTrustEvent.update({ where: { id: event.id }, data: { status: "DISPUTED" } });
    return transaction.appFreelancerTrustDispute.upsert({
      where: { eventId: event.id },
      create: { id: makeId("dispute"), eventId: event.id, userId, reason: reason.trim() },
      update: { reason: reason.trim(), status: "OPEN", resolutionNote: null, reviewedAt: null, reviewedByUserId: null },
    });
  });
  await calculateFreelancerTrustScore(userId);
  return { ok: true as const, dispute };
}

export function hashOauthValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function getFreelancerOnboardingBackfillReport(run = false) {
  const users = await prisma.appAuthUser.findMany({
    where: { OR: [{ role: "FREELANCER" }, { assignedRole: "FREELANCER" }, { packageAudience: "FREELANCER" }] },
    select: { id: true, displayName: true, email: true, phone: true },
  });
  const existing = await prisma.appFreelancerOnboarding.count({ where: { userId: { in: users.map((item) => item.id) } } });
  const results: Array<{ userId: string; completed: boolean; currentStep: number }> = [];
  if (run) {
    for (const user of users) {
      const state = await ensureFreelancerOnboarding({ userId: user.id, role: "FREELANCER", displayName: user.displayName, email: user.email, phone: user.phone });
      results.push({ userId: user.id, completed: state.completed, currentStep: state.onboarding.currentStep });
    }
  }
  return {
    totalFreelancers: users.length,
    existingOnboardingRecords: existing,
    recordsToCreate: Math.max(0, users.length - existing),
    executed: run,
    completedAfterBackfill: run ? results.filter((item) => item.completed).length : null,
    gatedAfterBackfill: run ? results.filter((item) => !item.completed).length : null,
    results,
  };
}
