import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type ConnectedAudience } from "@prisma/client";

import { buildYouTubeEmbedUrl, extractYouTubeVideoId } from "@/lib/connected-platform/youtube";
import { prisma } from "@/lib/prisma";
import { LearningInputError, learningOrder, validateLearningReorder, validateWatchInput } from "./learning-validation";

const ALL_PACKAGES = "ALL_MATCHING_PACKAGES";
const SELECTED_PACKAGES = "SELECTED_PACKAGES";

export class LearningAccessError extends Error {
  readonly code = "LEARNING_CHAPTER_LOCKED";
  readonly status = 402;
  constructor(message = "Upgrade your package to continue this chapter.") { super(message); }
}

function cleanTags(value: string[] | undefined) {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean))).slice(0, 20);
}

async function activePackageForUser(userId: string) {
  const user = await prisma.appAuthUser.findUnique({ where: { id: userId }, select: { packageId: true, packageStatus: true, packageExpiresAt: true } });
  const active = user?.packageStatus === "ACTIVE" && (!user.packageExpiresAt || user.packageExpiresAt.getTime() > Date.now());
  return active ? user.packageId : null;
}

function isChapterUnlocked(chapter: { accessMode: string; packageAccess: Array<{ packageId: string }> }, packageId: string | null, bypass: boolean) {
  if (bypass || chapter.accessMode !== SELECTED_PACKAGES) return true;
  return Boolean(packageId && chapter.packageAccess.some((item) => item.packageId === packageId));
}

export async function listConnectedLmsCatalog(input: { audience: ConnectedAudience; userId: string; includeDrafts?: boolean; query?: string }) {
  const [courses, activePackageId] = await Promise.all([
    prisma.salesTrainingCourse.findMany({
      where: { audiences: { has: input.audience }, ...(input.includeDrafts ? {} : { isPublished: true }) },
      include: {
        modules: {
          include: {
            packageAccess: { include: { package: { select: { id: true, name: true, slug: true, isFree: true, isActive: true } } } },
            lessons: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        progress: { where: { userId: input.userId } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    activePackageForUser(input.userId),
  ]);
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const catalog = courses.map((course) => {
    const progressByLesson = new Map(course.progress.filter((item) => item.lessonId).map((item) => [item.lessonId as string, item]));
    const chapters = course.modules.filter((chapter) => input.includeDrafts || chapter.isPublished).map((chapter) => {
      const unlocked = isChapterUnlocked(chapter, activePackageId, Boolean(input.includeDrafts));
      const lessons = chapter.lessons.filter((lesson) => input.includeDrafts || lesson.isPublished).map((lesson) => {
        const progress = progressByLesson.get(lesson.id);
        return {
          id: lesson.id, chapterId: chapter.id, title: lesson.title, description: lesson.description, tags: lesson.tags,
          youtubeVideoId: unlocked ? lesson.youtubeVideoId : null, videoUrl: unlocked ? lesson.videoUrl : null, videoEmbedUrl: unlocked ? lesson.videoEmbedUrl : null,
          estimatedDuration: lesson.estimatedDuration, isRequired: lesson.isRequired, isPublished: lesson.isPublished,
          completionThreshold: lesson.completionThreshold, sortOrder: lesson.sortOrder, locked: !unlocked,
          progress: progress ? { status: progress.status, progressPercent: progress.progressPercent, watchedSeconds: progress.watchedSeconds, durationSeconds: progress.durationSeconds, lastPositionSeconds: progress.lastPositionSeconds, confirmedAt: progress.confirmedAt?.toISOString() ?? null, completedAt: progress.completedAt?.toISOString() ?? null } : null,
        };
      });
      const completed = lessons.filter((lesson) => lesson.progress?.status === "COMPLETED").length;
      const requiredPackages = chapter.packageAccess.map((item) => item.package).filter((pkg) => pkg.isActive).map((pkg) => ({ id: pkg.id, name: pkg.name, slug: pkg.slug, isFree: pkg.isFree }));
      return {
        id: chapter.id, courseId: course.id, title: chapter.title, description: chapter.description, thumbnailUrl: chapter.thumbnailUrl,
        tags: chapter.tags, accessMode: chapter.accessMode, isPublished: chapter.isPublished, sortOrder: chapter.sortOrder, locked: !unlocked,
        packageIds: input.includeDrafts ? chapter.packageAccess.map(item => item.packageId) : undefined,
        requiredPackages, lessonCount: lessons.length, estimatedDuration: lessons.reduce((sum, lesson) => sum + (lesson.estimatedDuration ?? 0), 0),
        completionPercent: lessons.length ? Math.round((completed / lessons.length) * 100) : 0, lessons,
      };
    });
    const allLessons = chapters.flatMap((chapter) => chapter.lessons);
    const requiredLessons = allLessons.filter((lesson) => lesson.isRequired && !lesson.locked);
    const completedRequired = requiredLessons.filter((lesson) => lesson.progress?.status === "COMPLETED").length;
    const matched = !query || [course.title, course.description, ...chapters.flatMap((chapter) => [chapter.title, chapter.description, ...chapter.tags, ...chapter.lessons.flatMap((lesson) => [lesson.title, lesson.description, ...lesson.tags])])].some((value) => value?.toLocaleLowerCase().includes(query));
    return {
      id: course.id, title: course.title, description: course.description, thumbnailUrl: course.thumbnailUrl, audiences: course.audiences,
      isRequired: course.isRequired, isPublished: course.isPublished, sortOrder: course.sortOrder,
      completionPercent: requiredLessons.length ? Math.round((completedRequired / requiredLessons.length) * 100) : 0,
      chapterCount: chapters.length, lessonCount: allLessons.length, estimatedDuration: allLessons.reduce((sum, lesson) => sum + (lesson.estimatedDuration ?? 0), 0),
      chapters, modules: chapters, lessons: allLessons.filter((lesson) => !lesson.locked), matched,
    };
  }).filter((course) => course.matched).map(({ matched, ...course }) => {
    void matched;
    return course;
  });
  const continueLearning = catalog.flatMap((playlist) => playlist.chapters.flatMap((chapter) => chapter.lessons.map((lesson) => ({ playlist, chapter, lesson })))).filter((item) => !item.lesson.locked && item.lesson.progress?.status === "IN_PROGRESS").sort((left, right) => (right.lesson.progress?.progressPercent ?? 0) - (left.lesson.progress?.progressPercent ?? 0))[0];
  return { activePackageId, continueLearning: continueLearning ? { playlistId: continueLearning.playlist.id, chapterId: continueLearning.chapter.id, lessonId: continueLearning.lesson.id } : null, playlists: catalog, courses: catalog };
}

export async function updateConnectedLmsProgress(input: {
  userId: string; audience: ConnectedAudience; courseId: string; chapterId?: string; lessonId: string;
  playbackSessionId?: string; eventId?: string; activeSeconds?: number; playbackState?: string;
  watchedSeconds: number; durationSeconds: number; positionSeconds: number; confirmComplete?: boolean;
}) {
  validateWatchInput(input);
  const lesson = await prisma.salesTrainingLesson.findFirst({
    where: { id: input.lessonId, courseId: input.courseId, isPublished: true, course: { audiences: { has: input.audience }, isPublished: true } },
    include: { module: { include: { packageAccess: true } } },
  });
  if (!lesson?.module?.isPublished || (input.chapterId && lesson.module.id !== input.chapterId)) throw new LearningInputError("Learning lesson was not found for this app.", 404);
  const chapter = lesson.module;
  const packageId = await activePackageForUser(input.userId);
  if (!isChapterUnlocked(chapter, packageId, false)) throw new LearningAccessError();
  const now = new Date();
  const sessionId = input.playbackSessionId?.trim().slice(0, 100) || randomUUID();
  const eventId = input.eventId?.trim().slice(0, 100) || randomUUID();
  const durationSeconds = Math.max(0, Math.round(input.durationSeconds));
  const positionSeconds = Math.max(0, Math.min(durationSeconds || Number.MAX_SAFE_INTEGER, Math.round(input.positionSeconds)));
  const playbackState = input.playbackState === "PLAYING" ? "PLAYING" : input.playbackState === "ENDED" ? "ENDED" : "PAUSED";
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([input.userId, input.lessonId])}, 0))::text`);
      const duplicate = await tx.learningWatchEvent.findUnique({ where: { id: eventId } });
      if (duplicate && (duplicate.userId !== input.userId || duplicate.lessonId !== input.lessonId || duplicate.sessionId !== sessionId)) throw new LearningInputError("Playback event does not belong to this lesson.", 409);
      if (duplicate) return tx.salesTrainingProgress.findUnique({ where: { userId_courseId_lessonId: { userId: input.userId, courseId: input.courseId, lessonId: input.lessonId } } });
      const [existingSession, existingProgress] = await Promise.all([
        tx.learningWatchSession.findUnique({ where: { id: sessionId } }),
        tx.salesTrainingProgress.findUnique({ where: { userId_courseId_lessonId: { userId: input.userId, courseId: input.courseId, lessonId: input.lessonId } } }),
      ]);
      if (existingSession && (existingSession.userId !== input.userId || existingSession.lessonId !== input.lessonId)) throw new LearningInputError("Playback session does not belong to this lesson.", 409);
      const elapsed = existingSession ? Math.max(0, (now.getTime() - existingSession.lastHeartbeatAt.getTime()) / 1000) : 10;
      const requestedActive = Number.isFinite(input.activeSeconds) ? Number(input.activeSeconds) : Math.max(0, input.watchedSeconds - (existingProgress?.watchedSeconds ?? 0));
      const activeSeconds = Math.max(0, Math.min(15, Math.floor(requestedActive), Math.floor(elapsed + 2)));
      await tx.learningWatchSession.upsert({ where: { id: sessionId }, create: { id: sessionId, userId: input.userId, courseId: input.courseId, chapterId: chapter.id, lessonId: input.lessonId, activeWatchedSeconds: activeSeconds, durationSeconds, lastPositionSeconds: positionSeconds, lastEventId: eventId, lastHeartbeatAt: now }, update: { activeWatchedSeconds: { increment: activeSeconds }, durationSeconds, lastPositionSeconds: positionSeconds, lastEventId: eventId, lastHeartbeatAt: now } });
      await tx.learningWatchEvent.create({ data: { id: eventId, sessionId, userId: input.userId, lessonId: input.lessonId, activeSeconds, positionSeconds, durationSeconds, playbackState } });
      const watched = await tx.learningWatchSession.aggregate({ where: { userId: input.userId, lessonId: input.lessonId }, _sum: { activeWatchedSeconds: true }, _max: { durationSeconds: true } });
      const totalDuration = Math.max(durationSeconds, watched._max.durationSeconds ?? 0, lesson.estimatedDuration ?? 0);
      const watchedSeconds = Math.min(totalDuration || Number.MAX_SAFE_INTEGER, watched._sum.activeWatchedSeconds ?? 0);
      const progressPercent = totalDuration > 0 ? Math.min(100, Math.round((watchedSeconds / totalDuration) * 100)) : 0;
      const completed = progressPercent >= lesson.completionThreshold || existingProgress?.status === "COMPLETED";
      if (completed) await tx.learningWatchSession.update({ where: { id: sessionId }, data: { completedAt: now } });
      return tx.salesTrainingProgress.upsert({
        where: { userId_courseId_lessonId: { userId: input.userId, courseId: input.courseId, lessonId: input.lessonId } },
        create: { userId: input.userId, courseId: input.courseId, lessonId: input.lessonId, status: completed ? "COMPLETED" : progressPercent > 0 ? "IN_PROGRESS" : "NOT_STARTED", progressPercent: completed ? 100 : progressPercent, watchedSeconds, durationSeconds: totalDuration, lastPositionSeconds: positionSeconds, confirmedAt: completed ? now : null, completedAt: completed ? now : null },
        update: { status: completed ? "COMPLETED" : progressPercent > 0 ? "IN_PROGRESS" : undefined, progressPercent: Math.max(existingProgress?.progressPercent ?? 0, completed ? 100 : progressPercent), watchedSeconds: Math.max(existingProgress?.watchedSeconds ?? 0, watchedSeconds), durationSeconds: totalDuration, lastPositionSeconds: positionSeconds, confirmedAt: completed ? (existingProgress?.confirmedAt ?? now) : undefined, completedAt: completed ? (existingProgress?.completedAt ?? now) : undefined },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.learningWatchEvent.findUnique({where:{id:eventId}});
      if (duplicate?.userId === input.userId && duplicate.lessonId === input.lessonId && duplicate.sessionId === sessionId) return prisma.salesTrainingProgress.findUnique({ where: { userId_courseId_lessonId: { userId: input.userId, courseId: input.courseId, lessonId: input.lessonId } } });
    }
    throw error;
  }
}

export async function saveConnectedLmsCourse(input: { id?: string; title: string; description?: string; thumbnailUrl?: string; audiences: ConnectedAudience[]; isRequired: boolean; isPublished: boolean; sortOrder: number; createdById: string }) {
  const title = input.title.trim();
  if (!title) throw new LearningInputError("Playlist title is required.");
  if (!input.audiences.length) throw new LearningInputError("Choose at least one app audience.");
  const data = { title, description: input.description?.trim() || null, thumbnailUrl: input.thumbnailUrl?.trim() || null, audiences: Array.from(new Set(input.audiences)), assignedRole: input.audiences.join(","), isRequired: input.isRequired, isPublished: input.isPublished, publishedAt: input.isPublished ? new Date() : null, sortOrder: learningOrder(input.sortOrder), createdById: input.createdById };
  return input.id ? prisma.salesTrainingCourse.update({ where: { id: input.id }, data }) : prisma.salesTrainingCourse.create({ data });
}

export async function saveConnectedLmsChapter(input: { id?: string; courseId: string; title: string; description?: string; thumbnailUrl?: string; tags?: string[]; packageIds?: string[]; accessMode?: string; isPublished: boolean; sortOrder: number }) {
  const title = input.title.trim();
  if (!title) throw new LearningInputError("Chapter title is required.");
  if (!await prisma.salesTrainingCourse.findUnique({ where: { id: input.courseId }, select: { id: true } })) throw new LearningInputError("Playlist was not found.", 404);
  if (input.id && !await prisma.salesTrainingModule.findFirst({ where: {id: input.id, courseId: input.courseId}, select: {id:true} })) throw new LearningInputError("Chapter does not belong to this playlist.");
  const accessMode = input.accessMode === SELECTED_PACKAGES ? SELECTED_PACKAGES : ALL_PACKAGES;
  const packageIds = Array.from(new Set(input.packageIds ?? [])).filter(Boolean);
  if (accessMode === SELECTED_PACKAGES && !packageIds.length) throw new LearningInputError("Choose at least one package for a locked chapter.");
  return prisma.$transaction(async (tx) => {
    const data = { courseId: input.courseId, title, description: input.description?.trim() || null, thumbnailUrl: input.thumbnailUrl?.trim() || null, tags: cleanTags(input.tags), accessMode, isPublished: input.isPublished, sortOrder: learningOrder(input.sortOrder) };
    const chapter = input.id ? await tx.salesTrainingModule.update({ where: { id: input.id }, data }) : await tx.salesTrainingModule.create({ data });
    await tx.learningChapterPackageAccess.deleteMany({ where: { chapterId: chapter.id } });
    if (accessMode === SELECTED_PACKAGES) await tx.learningChapterPackageAccess.createMany({ data: packageIds.map((packageId) => ({ chapterId: chapter.id, packageId })), skipDuplicates: true });
    return chapter;
  });
}

export async function saveConnectedLmsLesson(input: { id?: string; courseId: string; moduleId: string; title: string; description?: string; tags?: string[]; youtubeUrl: string; estimatedDuration?: number; isRequired: boolean; isPublished: boolean; completionThreshold?: number; sortOrder: number }) {
  const title = input.title.trim();
  if (!title) throw new LearningInputError("Lesson title is required.");
  const youtubeVideoId = extractYouTubeVideoId(input.youtubeUrl);
  if (!youtubeVideoId) throw new LearningInputError("Enter a valid YouTube or youtu.be video URL.");
  if (!await prisma.salesTrainingModule.findFirst({ where: { id: input.moduleId, courseId: input.courseId }, select: { id: true } })) throw new LearningInputError("Choose a chapter from this playlist.");
  if (input.id && !await prisma.salesTrainingLesson.findFirst({where:{id:input.id, courseId:input.courseId, moduleId:input.moduleId},select:{id:true}})) throw new LearningInputError("Lesson does not belong to this chapter.");
  if (!Number.isFinite(input.completionThreshold ?? 90) || (input.estimatedDuration !== undefined && (!Number.isFinite(input.estimatedDuration) || input.estimatedDuration < 0 || input.estimatedDuration > 604800))) throw new LearningInputError("Enter a valid lesson duration and completion threshold.");
  const threshold = Math.min(100, Math.max(50, Math.round(input.completionThreshold ?? 90)));
  const data = { courseId: input.courseId, moduleId: input.moduleId, title, description: input.description?.trim() || null, tags: cleanTags(input.tags), videoUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`, videoEmbedUrl: buildYouTubeEmbedUrl(youtubeVideoId), youtubeVideoId, estimatedDuration: input.estimatedDuration && input.estimatedDuration > 0 ? Math.round(input.estimatedDuration) : null, isRequired: input.isRequired, isPublished: input.isPublished, completionThreshold: threshold, sortOrder: learningOrder(input.sortOrder) };
  return input.id ? prisma.salesTrainingLesson.update({ where: { id: input.id }, data }) : prisma.salesTrainingLesson.create({ data });
}

export async function deleteConnectedLmsEntity(input: { entity: "playlist" | "chapter" | "lesson"; id: string }) {
  if (input.entity === "playlist") return prisma.salesTrainingCourse.delete({ where: { id: input.id } });
  if (input.entity === "chapter") return prisma.salesTrainingModule.delete({ where: { id: input.id } });
  return prisma.salesTrainingLesson.delete({ where: { id: input.id } });
}

export async function reorderConnectedLmsEntities(input: { entity: "playlist" | "chapter" | "lesson"; items: Array<{ id: string; sortOrder: number }> }) {
  validateLearningReorder(input.items);
  const ids = input.items.map(item => item.id);
  const rows = input.entity === "playlist"
    ? await prisma.salesTrainingCourse.findMany({where:{id:{in:ids}},select:{id:true}})
    : input.entity === "chapter" ? await prisma.salesTrainingModule.findMany({where:{id:{in:ids}},select:{id:true,courseId:true}})
    : await prisma.salesTrainingLesson.findMany({where:{id:{in:ids}},select:{id:true,moduleId:true}});
  if (rows.length !== ids.length) throw new LearningInputError("Some learning content no longer exists. Refresh the library.");
  const parents = new Set(rows.map(row => "moduleId" in row ? row.moduleId : "courseId" in row ? row.courseId : null));
  if (parents.size > 1) throw new LearningInputError("Only reorder content within the same playlist or chapter.");
  const operations = input.items.map((item) => {
    if (input.entity === "playlist") {
      return prisma.salesTrainingCourse.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
    }
    if (input.entity === "chapter") {
      return prisma.salesTrainingModule.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
    }
    return prisma.salesTrainingLesson.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
  });
  return prisma.$transaction(operations);
}

export async function getConnectedLmsAnalytics() {
  const [learners, sessions, progress, lessons] = await Promise.all([
    prisma.salesTrainingProgress.groupBy({ by: ["userId"] }),
    prisma.learningWatchSession.aggregate({ _sum: { activeWatchedSeconds: true }, _count: { id: true } }),
    prisma.salesTrainingProgress.groupBy({ by: ["status"], _count: { id: true }, _avg: { progressPercent: true } }),
    prisma.salesTrainingProgress.groupBy({ by: ["lessonId"], _count: { id: true }, _avg: { progressPercent: true }, orderBy: { _avg: { progressPercent: "asc" } }, take: 10 }),
  ]);
  return { learnerCount: learners.length, sessionCount: sessions._count.id, watchedSeconds: sessions._sum.activeWatchedSeconds ?? 0, progress, dropOffLessons: lessons };
}
