import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ensureDefaultGappWebinar } from "@/lib/gigxomi/gapp-webinar-store";
import type { AppRole } from "@/lib/auth/types";

export const salesTrainingSteps = [
  { key: "trainee_joined", title: "Trainee Joined", requirement: "Sales account approved", reward: "Access orientation" },
  { key: "orientation_complete", title: "Orientation Complete", requirement: "Complete orientation lesson", reward: "Unlock product basics" },
  { key: "product_training_complete", title: "Product/Package Training Complete", requirement: "Complete Product Basics course", reward: "Unlock script training" },
  { key: "script_training_complete", title: "Script Training Complete", requirement: "Complete script practice", reward: "Unlock objection handling" },
  { key: "objection_training_complete", title: "Objection Handling Complete", requirement: "Complete objection module", reward: "Unlock AI mock call" },
  { key: "ai_mock_call_submitted", title: "AI Mock Call Submitted", requirement: "Submit mock call transcript", reward: "Manager review starts" },
  { key: "quiz_passed", title: "Quiz Passed", requirement: "Pass sales basics quiz", reward: "Review eligibility" },
  { key: "manager_review_approved", title: "Manager Review Approved", requirement: "Mock call approved", reward: "Unlock first leads" },
  { key: "unlock_10_leads", title: "Unlock 10 Leads", requirement: "Quiz passed + mock call approved", reward: "10 real leads available" },
  { key: "first_followup_review", title: "First Follow-up Review", requirement: "Complete first follow-up audit", reward: "Unlock more leads" },
  { key: "unlock_20_leads", title: "Unlock 20 Leads", requirement: "Consistent follow-up quality", reward: "20 real leads available" },
  { key: "verified_sales_agent", title: "Verified Sales Agent", requirement: "Stable conversion and call quality", reward: "Verified badge" },
  { key: "monthly_target_2l", title: "Monthly Target INR 2L Achieved", requirement: "Close INR 2L in a month", reward: "Manager path eligibility" },
  { key: "manager_path_unlocked", title: "Manager Path Unlocked", requirement: "Leadership review", reward: "Leader training access" },
  { key: "team_creation_unlocked", title: "Team Creation Access Unlocked", requirement: "Manager path approved", reward: "Create subagent team" },
];

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function normalizeVideoUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { videoUrl: "", embedUrl: "" };
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host.includes("youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return { videoUrl: `https://www.youtube.com/watch?v=${id}`, embedUrl: id ? `https://www.youtube.com/embed/${id}?rel=0` : trimmed };
    }
    if (host.includes("youtube.com")) {
      const id = url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).at(-1) || "";
      return { videoUrl: trimmed, embedUrl: id ? `https://www.youtube.com/embed/${id}?rel=0` : trimmed };
    }
    if (host.includes("vimeo.com")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return { videoUrl: trimmed, embedUrl: id ? `https://player.vimeo.com/video/${id}` : trimmed };
    }
  } catch {
    return { videoUrl: trimmed, embedUrl: "" };
  }
  return { videoUrl: trimmed, embedUrl: trimmed };
}

function activeStepFromSignals(input: {
  completedLessonCount: number;
  completedCourseCount: number;
  approvedMockCallCount: number;
  totalMockCallCount: number;
  paidRevenue: number;
}) {
  if (input.paidRevenue >= 200000) return { currentLevel: "MONTHLY_TARGET_2L", currentStep: "monthly_target_2l", leadsUnlocked: 20, managerPathUnlocked: true, teamCreationUnlocked: false };
  if (input.approvedMockCallCount && input.completedCourseCount) return { currentLevel: "VERIFIED_SALES_AGENT", currentStep: "verified_sales_agent", leadsUnlocked: 20, managerPathUnlocked: false, teamCreationUnlocked: false };
  if (input.approvedMockCallCount) return { currentLevel: "UNLOCK_10_LEADS", currentStep: "unlock_10_leads", leadsUnlocked: 10, managerPathUnlocked: false, teamCreationUnlocked: false };
  if (input.totalMockCallCount) return { currentLevel: "AI_MOCK_CALL_SUBMITTED", currentStep: "ai_mock_call_submitted", leadsUnlocked: 0, managerPathUnlocked: false, teamCreationUnlocked: false };
  if (input.completedLessonCount >= 2) return { currentLevel: "OBJECTION_TRAINING_COMPLETE", currentStep: "objection_training_complete", leadsUnlocked: 0, managerPathUnlocked: false, teamCreationUnlocked: false };
  if (input.completedLessonCount === 1) return { currentLevel: "ORIENTATION_COMPLETE", currentStep: "orientation_complete", leadsUnlocked: 0, managerPathUnlocked: false, teamCreationUnlocked: false };
  return { currentLevel: "TRAINEE_JOINED", currentStep: "trainee_joined", leadsUnlocked: 0, managerPathUnlocked: false, teamCreationUnlocked: false };
}

async function ensureSalesOperatingDefaults() {
  for (const [index, step] of salesTrainingSteps.entries()) {
    await prisma.salesUnlockRule.upsert({
      where: { stepKey: step.key },
      update: {
        title: step.title,
        requirement: step.requirement,
        reward: step.reward,
        sortOrder: index,
        isActive: true,
      },
      create: {
        stepKey: step.key,
        title: step.title,
        description: step.requirement,
        requirement: step.requirement,
        reward: step.reward,
        leadUnlockQuantity: step.key === "unlock_10_leads" ? 10 : step.key === "unlock_20_leads" ? 20 : 0,
        sortOrder: index,
      },
    });
  }

  const courseCount = await prisma.salesTrainingCourse.count();
  if (!courseCount) {
    const course = await prisma.salesTrainingCourse.create({
      data: {
        title: "Gigxomi Sales Orientation",
        description: "First sales training path for freshers and new agents.",
        isPublished: true,
        requiredCompletionPercent: 100,
        leadUnlockQuantity: 10,
        sortOrder: 1,
      },
    });
    const trainingModule = await prisma.salesTrainingModule.create({
      data: {
        courseId: course.id,
        title: "Sales Basics",
        description: "Product, script, objection handling, and first follow-up habits.",
        sortOrder: 1,
      },
    });
    await prisma.salesTrainingLesson.createMany({
      data: [
        {
          courseId: course.id,
          moduleId: trainingModule.id,
          title: "Welcome to Gigxomi Sales",
          description: "Understand the platform, pitch, and lead discipline.",
          content: "Use this first lesson to align on the sales process before taking live leads.",
          sortOrder: 1,
        },
        {
          courseId: course.id,
          moduleId: trainingModule.id,
          title: "Price Objection Practice",
          description: "Practice handling budget and trust objections.",
          content: "Write your response, then submit an AI practice mock call for review.",
          quizRequired: true,
          mockCallRequired: true,
          sortOrder: 2,
        },
      ],
    });
  }

  const postCount = await prisma.salesLearningPost.count();
  if (!postCount) {
    await prisma.salesLearningPost.create({
      data: {
        title: "First rule: never lose the next move",
        body: "Every conversation should end with a follow-up, webinar invite, or clear close/lost reason.",
        category: "Sales tip",
        audience: "all",
        isPinned: true,
        isActive: true,
      },
    });
  }
}

export async function getSalesOperatingSnapshot(session: { userId?: string | null; role: AppRole | "GUEST" }) {
  await ensureSalesOperatingDefaults();
  await ensureDefaultGappWebinar();
  const agent = session.userId
    ? await prisma.salesAgentProfile.findUnique({ where: { userId: session.userId }, include: { user: true } })
    : null;
  const userId = session.userId ?? "";
  const agentId = agent?.id ?? null;
  const [
    courses,
    modules,
    lessons,
    progress,
    unlockRules,
    agentLevel,
    mockCalls,
    webinars,
    webinarInvites,
    learningPosts,
    timeline,
    roundRobinRules,
  ] = await Promise.all([
    prisma.salesTrainingCourse.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.salesTrainingModule.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.salesTrainingLesson.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    userId ? prisma.salesTrainingProgress.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }) : Promise.resolve([]),
    prisma.salesUnlockRule.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    userId
      ? prisma.salesAgentLevel.upsert({
          where: { userId },
          update: {},
          create: { userId, agentId, currentLevel: "TRAINEE_JOINED", currentStep: "trainee_joined" },
        })
      : Promise.resolve(null),
    userId
      ? prisma.salesMockCallAttempt.findMany({
          where: session.role === "SUPER_ADMIN" ? {} : { userId },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    prisma.salesWebinar.findMany({
      where: session.role === "SUPER_ADMIN" ? {} : { isActive: true },
      orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.salesWebinarInvite.findMany({ where: session.role === "SUPER_ADMIN" ? {} : agentId ? { agentId } : { agentId: "__none" }, orderBy: { invitedAt: "desc" }, take: 100 }),
    prisma.salesLearningPost.findMany({ where: { isActive: true }, orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }], take: 50 }),
    prisma.salesLeadTimelineEntry.findMany({ where: session.role === "SUPER_ADMIN" ? {} : agentId ? { agentId } : { agentId: "__none" }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.salesRoundRobinRule.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] }),
  ]);

  return {
    courses: courses.map((course) => ({
      ...course,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
    })),
    modules: modules.map((trainingModule) => ({ ...trainingModule, createdAt: trainingModule.createdAt.toISOString(), updatedAt: trainingModule.updatedAt.toISOString() })),
    lessons: lessons.map((lesson) => ({ ...lesson, createdAt: lesson.createdAt.toISOString(), updatedAt: lesson.updatedAt.toISOString() })),
    progress: progress.map((item) => ({ ...item, completedAt: iso(item.completedAt), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
    unlockRules: unlockRules.map((rule) => ({ ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() })),
    agentLevel: agentLevel ? { ...agentLevel, updatedAt: agentLevel.updatedAt.toISOString() } : null,
    mockCalls: mockCalls.map((call) => ({ ...call, reviewedAt: iso(call.reviewedAt), createdAt: call.createdAt.toISOString(), updatedAt: call.updatedAt.toISOString() })),
    webinars: webinars.map((webinar) => ({ ...webinar, startsAt: webinar.startsAt.toISOString(), createdAt: webinar.createdAt.toISOString(), updatedAt: webinar.updatedAt.toISOString() })),
    webinarInvites: webinarInvites.map((invite) => ({ ...invite, invitedAt: invite.invitedAt.toISOString(), attendedAt: iso(invite.attendedAt) })),
    learningPosts: learningPosts.map((post) => ({ ...post, createdAt: post.createdAt.toISOString(), updatedAt: post.updatedAt.toISOString() })),
    timeline: timeline.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    roundRobinRules: roundRobinRules.map((rule) => ({ ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() })),
  };
}

export type SalesOperatingSnapshot = Awaited<ReturnType<typeof getSalesOperatingSnapshot>>;

export async function saveSalesCourse(input: {
  id?: string;
  title: string;
  description?: string;
  videoUrl?: string;
  assignedRole?: string;
  assignedTeamId?: string;
  isPublished?: boolean;
  requiredCompletionPercent?: number;
  requiredQuizScore?: number | null;
  requiresMockCall?: boolean;
  requiresManagerReview?: boolean;
  leadUnlockQuantity?: number;
  sortOrder?: number;
  createdById?: string | null;
}) {
  const data = {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    assignedRole: input.assignedRole?.trim() || null,
    assignedTeamId: input.assignedTeamId?.trim() || null,
    isPublished: Boolean(input.isPublished),
    requiredCompletionPercent: Math.max(0, Math.min(100, Number(input.requiredCompletionPercent ?? 100))),
    requiredQuizScore: input.requiredQuizScore == null ? null : Math.max(0, Math.min(100, Number(input.requiredQuizScore))),
    requiresMockCall: Boolean(input.requiresMockCall),
    requiresManagerReview: Boolean(input.requiresManagerReview),
    leadUnlockQuantity: Math.max(0, Number(input.leadUnlockQuantity ?? 0)),
    sortOrder: Number(input.sortOrder ?? 0),
    createdById: input.createdById ?? null,
  };
  if (!data.title) throw new Error("Course title is required.");
  return input.id ? prisma.salesTrainingCourse.update({ where: { id: input.id }, data }) : prisma.salesTrainingCourse.create({ data });
}

export async function saveSalesModule(input: { id?: string; courseId: string; title: string; description?: string; sortOrder?: number }) {
  const data = {
    courseId: input.courseId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    sortOrder: Number(input.sortOrder ?? 0),
  };
  if (!data.courseId || !data.title) throw new Error("Module needs a course and title.");
  return input.id ? prisma.salesTrainingModule.update({ where: { id: input.id }, data }) : prisma.salesTrainingModule.create({ data });
}

export async function saveSalesLesson(input: {
  id?: string;
  courseId: string;
  moduleId?: string | null;
  title: string;
  description?: string;
  videoUrl?: string;
  content?: string;
  estimatedDuration?: number | null;
  isRequired?: boolean;
  quizRequired?: boolean;
  mockCallRequired?: boolean;
  managerReviewRequired?: boolean;
  sortOrder?: number;
}) {
  const video = normalizeVideoUrl(input.videoUrl ?? "");
  const data = {
    courseId: input.courseId,
    moduleId: input.moduleId?.trim() || null,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    videoUrl: video.videoUrl || null,
    videoEmbedUrl: video.embedUrl || null,
    content: input.content?.trim() || null,
    estimatedDuration: input.estimatedDuration == null ? null : Math.max(0, Number(input.estimatedDuration)),
    isRequired: input.isRequired ?? true,
    quizRequired: Boolean(input.quizRequired),
    mockCallRequired: Boolean(input.mockCallRequired),
    managerReviewRequired: Boolean(input.managerReviewRequired),
    sortOrder: Number(input.sortOrder ?? 0),
  };
  if (!data.courseId || !data.title) throw new Error("Lesson needs a course and title.");
  return input.id ? prisma.salesTrainingLesson.update({ where: { id: input.id }, data }) : prisma.salesTrainingLesson.create({ data });
}

export async function markSalesLessonComplete(input: { userId: string; agentId?: string | null; courseId: string; lessonId: string }) {
  const progress = await prisma.salesTrainingProgress.upsert({
    where: { userId_courseId_lessonId: { userId: input.userId, courseId: input.courseId, lessonId: input.lessonId } },
    update: { status: "COMPLETED", progressPercent: 100, completedAt: new Date() },
    create: {
      userId: input.userId,
      agentId: input.agentId ?? null,
      courseId: input.courseId,
      lessonId: input.lessonId,
      status: "COMPLETED",
      progressPercent: 100,
      completedAt: new Date(),
    },
  });
  await evaluateSalesAgentLevel({ userId: input.userId, agentId: input.agentId ?? null });
  return progress;
}

export async function submitSalesMockCall(input: { userId: string; agentId?: string | null; scenario: string; transcript: string }) {
  return prisma.salesMockCallAttempt.create({
    data: {
      userId: input.userId,
      agentId: input.agentId ?? null,
      scenario: input.scenario.trim(),
      transcript: input.transcript.trim(),
      status: "PENDING_REVIEW",
    },
  });
}

export async function reviewSalesMockCall(input: { id: string; reviewerId: string; status: string; managerScore?: number | null; feedback?: string }) {
  const attempt = await prisma.salesMockCallAttempt.update({
    where: { id: input.id },
    data: {
      status: input.status,
      managerScore: input.managerScore == null ? null : Math.max(0, Math.min(100, Number(input.managerScore))),
      feedback: input.feedback?.trim() || null,
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
    },
  });
  await evaluateSalesAgentLevel({ userId: attempt.userId, agentId: attempt.agentId });
  return attempt;
}

export async function saveSalesLearningPost(input: { id?: string; title: string; body: string; category?: string; audience?: string; authorId?: string | null; isPinned?: boolean; isActive?: boolean; linkUrl?: string; videoUrl?: string }) {
  const data = {
    title: input.title.trim(),
    body: input.body.trim(),
    category: input.category?.trim() || "Sales tip",
    audience: input.audience?.trim() || "all",
    authorId: input.authorId ?? null,
    isPinned: Boolean(input.isPinned),
    isActive: input.isActive ?? true,
    linkUrl: input.linkUrl?.trim() || null,
    videoUrl: input.videoUrl?.trim() || null,
  };
  if (!data.title || !data.body) throw new Error("Learning post needs a title and body.");
  return input.id ? prisma.salesLearningPost.update({ where: { id: input.id }, data }) : prisma.salesLearningPost.create({ data });
}

export async function toggleSalesLearningPostReaction(input: { postId: string; userId: string; type?: string }) {
  const type = input.type ?? "helpful";
  const existing = await prisma.salesLearningPostReaction.findUnique({
    where: { postId_userId_type: { postId: input.postId, userId: input.userId, type } },
  });
  if (existing) {
    await prisma.salesLearningPostReaction.delete({ where: { id: existing.id } });
    return { active: false };
  }
  await prisma.salesLearningPostReaction.create({ data: { postId: input.postId, userId: input.userId, type } });
  return { active: true };
}

export async function saveSalesWebinar(input: { id?: string; title: string; description?: string; hostId?: string | null; startsAt: string; registrationLink?: string; isActive?: boolean }) {
  const title = input.title.trim().slice(0, 160);
  const startsAt = new Date(input.startsAt);
  const registrationLink = input.registrationLink?.trim() || "";
  if (!title || Number.isNaN(startsAt.getTime())) throw new Error("Webinar needs a title and valid date and time.");
  if (startsAt.getTime() < Date.now() + 5 * 60 * 1000) throw new Error("Choose a webinar time at least 5 minutes in the future.");
  const isInternalRegistrationLink = registrationLink.startsWith("/") && !registrationLink.startsWith("//");
  if (registrationLink && !isInternalRegistrationLink) {
    let parsedLink: URL;
    try {
      parsedLink = new URL(registrationLink);
    } catch {
      throw new Error("Registration link must be a valid website address or an internal /path.");
    }
    if (parsedLink.protocol !== "https:" && parsedLink.protocol !== "http:") {
      throw new Error("Registration link must use HTTPS or HTTP.");
    }
  }

  const data = {
    title,
    description: input.description?.trim().slice(0, 1200) || null,
    hostId: input.hostId?.trim() || null,
    startsAt,
    registrationLink: registrationLink || null,
    isActive: input.isActive ?? true,
  };
  return input.id ? prisma.salesWebinar.update({ where: { id: input.id }, data }) : prisma.salesWebinar.create({ data });
}

export async function inviteSalesLeadToWebinar(input: { webinarId: string; leadId: string; agentId: string; notes?: string }) {
  await prisma.salesLeadTimelineEntry.create({
    data: {
      leadId: input.leadId,
      agentId: input.agentId,
      type: "WEBINAR_INVITE",
      body: input.notes?.trim() || "Lead invited to webinar.",
      metadata: { webinarId: input.webinarId },
    },
  });
  return prisma.salesWebinarInvite.upsert({
    where: { webinarId_leadId: { webinarId: input.webinarId, leadId: input.leadId } },
    update: { agentId: input.agentId, status: "INVITED", notes: input.notes?.trim() || null },
    create: { webinarId: input.webinarId, leadId: input.leadId, agentId: input.agentId, status: "INVITED", notes: input.notes?.trim() || null },
  });
}

export async function markSalesWebinarAttendance(input: { inviteId: string; attended: boolean; notes?: string }) {
  const invite = await prisma.salesWebinarInvite.update({
    where: { id: input.inviteId },
    data: {
      status: input.attended ? "ATTENDED" : "MISSED",
      attendedAt: input.attended ? new Date() : null,
      notes: input.notes?.trim() || undefined,
    },
  });
  await prisma.salesLeadTimelineEntry.create({
    data: {
      leadId: invite.leadId,
      agentId: invite.agentId,
      type: input.attended ? "WEBINAR_ATTENDED" : "WEBINAR_MISSED",
      body: input.attended ? "Lead attended webinar." : "Lead missed webinar.",
      metadata: { webinarId: invite.webinarId },
    },
  });
  return invite;
}

export async function addSalesLeadTimelineNote(input: { leadId: string; agentId?: string | null; userId?: string | null; type?: string; body: string; metadata?: Record<string, unknown> }) {
  const body = input.body.trim();
  if (!body) throw new Error("Write a note before saving.");
  return prisma.$transaction(async (transaction) => {
    const entry = await transaction.salesLeadTimelineEntry.create({
      data: {
        leadId: input.leadId,
        agentId: input.agentId ?? null,
        userId: input.userId ?? null,
        type: input.type ?? "NOTE",
        body,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
      },
    });
    await transaction.salesLeadAssignment.update({ where: { id: input.leadId }, data: { notes: body } });
    return entry;
  });
}

export async function saveSalesRoundRobinRule(input: { id?: string; title: string; teamId?: string; isActive?: boolean; maxActiveLeads?: number | null; requireTrainingLevel?: string; priorityMode?: string; batchSize?: number }) {
  const data = {
    title: input.title.trim(),
    teamId: input.teamId?.trim() || null,
    isActive: input.isActive ?? true,
    maxActiveLeads: input.maxActiveLeads == null ? null : Math.max(0, Number(input.maxActiveLeads)),
    requireTrainingLevel: input.requireTrainingLevel?.trim() || null,
    priorityMode: input.priorityMode?.trim() || null,
    batchSize: Math.max(1, Number(input.batchSize ?? 1)),
  };
  if (!data.title) throw new Error("Round-robin rule title is required.");
  return input.id ? prisma.salesRoundRobinRule.update({ where: { id: input.id }, data }) : prisma.salesRoundRobinRule.create({ data });
}

export async function evaluateSalesAgentLevel(input: { userId: string; agentId?: string | null; override?: Partial<{ currentLevel: string; currentStep: string; leadsUnlocked: number; managerPathUnlocked: boolean; teamCreationUnlocked: boolean; overrideNote: string }> }) {
  const [progress, mockCalls, revenue] = await Promise.all([
    prisma.salesTrainingProgress.findMany({ where: { userId: input.userId } }),
    prisma.salesMockCallAttempt.findMany({ where: { userId: input.userId } }),
    input.agentId
      ? prisma.salesDeal.aggregate({ where: { agentId: input.agentId, status: { in: ["PAID", "HANDOFF", "CLOSED"] } }, _sum: { paidAmount: true } })
      : Promise.resolve({ _sum: { paidAmount: null } }),
  ]);
  const completedLessons = progress.filter((item) => item.lessonId && item.status === "COMPLETED").length;
  const completedCourses = new Set(progress.filter((item) => item.status === "COMPLETED").map((item) => item.courseId)).size;
  const approvedMockCalls = mockCalls.filter((item) => item.status === "APPROVED").length;
  const signals = activeStepFromSignals({
    completedLessonCount: completedLessons,
    completedCourseCount: completedCourses,
    approvedMockCallCount: approvedMockCalls,
    totalMockCallCount: mockCalls.length,
    paidRevenue: Number(revenue._sum.paidAmount ?? 0),
  });
  return prisma.salesAgentLevel.upsert({
    where: { userId: input.userId },
    update: { ...signals, ...input.override, agentId: input.agentId ?? undefined },
    create: { userId: input.userId, agentId: input.agentId ?? null, ...signals, ...input.override },
  });
}
