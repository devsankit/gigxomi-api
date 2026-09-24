import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesOperatingSnapshot, saveSalesLearningPost } from "@/lib/gigxomi/sales-operating-system-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const snapshot = await getSalesOperatingSnapshot(authorization.session);
  return NextResponse.json({ ok: true, posts: snapshot.learningPosts });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid learning post details." }, { status: 400 });

  try {
    const post = await saveSalesLearningPost({
      id: typeof body.id === "string" ? body.id : undefined,
      title: String(body.title ?? ""),
      body: String(body.body ?? ""),
      category: typeof body.category === "string" ? body.category : "Sales tip",
      audience: typeof body.audience === "string" ? body.audience : "all",
      authorId: authorization.session.userId,
      isPinned: Boolean(body.isPinned),
      isActive: body.isActive !== false,
      linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : "",
      videoUrl: typeof body.videoUrl === "string" ? body.videoUrl : "",
    });
    return NextResponse.json({ ok: true, post });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save learning post." }, { status: 400 });
  }
}
