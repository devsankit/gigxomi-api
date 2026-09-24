import { NextResponse } from "next/server";
import type { ConnectedAudience } from "@prisma/client";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  deleteConnectedLmsEntity,
  getConnectedLmsAnalytics,
  listConnectedLmsCatalog,
  reorderConnectedLmsEntities,
  saveConnectedLmsChapter,
  saveConnectedLmsCourse,
  saveConnectedLmsLesson,
} from "@/lib/connected-platform/lms";
import { prisma } from "@/lib/prisma";
import { LearningInputError } from "@/lib/connected-platform/learning-validation";

const AUDIENCES = new Set<ConnectedAudience>(["CRM", "AGENCY", "FREELANCER"]);
const ENTITIES = new Set(["playlist", "chapter", "lesson"] as const);

function audiences(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is ConnectedAudience => typeof item === "string" && AUDIENCES.has(item as ConnectedAudience))
    : [];
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function entity(value: unknown): "playlist" | "chapter" | "lesson" | null {
  return typeof value === "string" && ENTITIES.has(value as "playlist" | "chapter" | "lesson")
    ? value as "playlist" | "chapter" | "lesson"
    : null;
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const requested = new URL(request.url).searchParams.get("audience")?.toUpperCase() as ConnectedAudience | undefined;
  const selected = requested && AUDIENCES.has(requested) ? [requested] : Array.from(AUDIENCES);
  try {
  const [catalogs, packages, analytics] = await Promise.all([
    Promise.all(selected.map(async (audience) => ({
      audience,
      ...(await listConnectedLmsCatalog({ audience, userId: authorization.session.userId, includeDrafts: true })),
    }))),
    prisma.package.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, packageType: true, isFree: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    getConnectedLmsAnalytics(),
  ]);
  return NextResponse.json({ ok: true, catalogs, packages, analytics });
  } catch { return NextResponse.json({ok:false,error:"LEARNING_UNAVAILABLE",message:"Learning Studio could not load. Please retry."},{status:503}); }
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (body?.entity === "reorder") {
      const target = entity(body.target);
      const items = Array.isArray(body.items)
        ? body.items.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const record = item as Record<string, unknown>;
            return typeof record.id === "string" ? [{ id: record.id, sortOrder: Number(record.sortOrder ?? 0) }] : [];
          })
        : [];
      if (!target || !items.length) throw new LearningInputError("Choose content to reorder.");
      await reorderConnectedLmsEntities({ entity: target, items });
      return NextResponse.json({ ok: true });
    }
    if (body?.entity === "chapter") {
      const chapter = await saveConnectedLmsChapter({
        id: typeof body.id === "string" ? body.id : undefined,
        courseId: typeof body.courseId === "string" ? body.courseId : "",
        title: typeof body.title === "string" ? body.title : "",
        description: typeof body.description === "string" ? body.description : undefined,
        thumbnailUrl: typeof body.thumbnailUrl === "string" ? body.thumbnailUrl : undefined,
        tags: strings(body.tags),
        packageIds: strings(body.packageIds),
        accessMode: typeof body.accessMode === "string" ? body.accessMode : undefined,
        isPublished: body.isPublished !== false,
        sortOrder: Number(body.sortOrder ?? 0),
      });
      return NextResponse.json({ ok: true, chapter });
    }
    if (body?.entity === "lesson") {
      const lesson = await saveConnectedLmsLesson({
        id: typeof body.id === "string" ? body.id : undefined,
        courseId: typeof body.courseId === "string" ? body.courseId : "",
        moduleId: typeof body.moduleId === "string" ? body.moduleId : "",
        title: typeof body.title === "string" ? body.title : "",
        description: typeof body.description === "string" ? body.description : undefined,
        tags: strings(body.tags),
        youtubeUrl: typeof body.youtubeUrl === "string" ? body.youtubeUrl : "",
        estimatedDuration: Number(body.estimatedDuration ?? 0),
        isRequired: body.isRequired !== false,
        isPublished: body.isPublished !== false,
        completionThreshold: Number(body.completionThreshold ?? 90),
        sortOrder: Number(body.sortOrder ?? 0),
      });
      return NextResponse.json({ ok: true, lesson });
    }
    const playlist = await saveConnectedLmsCourse({
      id: typeof body?.id === "string" ? body.id : undefined,
      title: typeof body?.title === "string" ? body.title : "",
      description: typeof body?.description === "string" ? body.description : undefined,
      thumbnailUrl: typeof body?.thumbnailUrl === "string" ? body.thumbnailUrl : undefined,
      audiences: audiences(body?.audiences),
      isRequired: body?.isRequired === true,
      isPublished: body?.isPublished !== false,
      sortOrder: Number(body?.sortOrder ?? 0),
      createdById: authorization.session.userId,
    });
    return NextResponse.json({ ok: true, playlist });
  } catch (error) {
    if (error instanceof LearningInputError) return NextResponse.json({ok:false,error:error.code,message:error.message},{status:error.status});
    return NextResponse.json({ ok: false, error: "LEARNING_SAVE_UNAVAILABLE", message: "Learning Studio could not save. Please retry." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const url = new URL(request.url);
  const target = entity(url.searchParams.get("entity"));
  const id = url.searchParams.get("id")?.trim();
  if (!target || !id) return NextResponse.json({ ok: false, error: "Choose Learning Studio content to delete." }, { status: 400 });
  try {
    await deleteConnectedLmsEntity({ entity: target, id });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "LEARNING_DELETE_UNAVAILABLE", message: "Learning Studio could not delete this content. Please retry." }, { status: 503 });
  }
}
