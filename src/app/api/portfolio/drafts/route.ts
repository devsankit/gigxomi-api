import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { createStandalonePortfolioDraft, getPortfolioDraftById, listPortfolioDrafts, updatePortfolioDraft } from "@/lib/gigxomi/delivery-portfolio-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const drafts = await listPortfolioDrafts();
  const visibleDrafts =
    authorization.session.role === "FREELANCER"
      ? drafts.filter((draft) => draft.freelancerName === authorization.session.displayName)
      : drafts;

  return NextResponse.json({
    ok: true,
    drafts: visibleDrafts,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json();
  if (typeof body.draftId !== "string" || !body.draftId.trim()) {
    if (authorization.session.role !== "FREELANCER") {
      return NextResponse.json({ ok: false, error: "Only freelancers can create portfolio drafts directly." }, { status: 403 });
    }

    const created = await createStandalonePortfolioDraft({
      freelancerId: authorization.session.userId,
      freelancerName: authorization.session.displayName,
      tenantId: authorization.session.tenantId,
      workScope: body.workScope === "CLIENT_WORK" ? "CLIENT_WORK" : "SELF_SAMPLE",
      conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
    });

    return NextResponse.json({
      ok: true,
      draft: created,
    });
  }

  const existingDraft = await getPortfolioDraftById(body.draftId);
  if (!existingDraft) {
    return NextResponse.json({ ok: false, error: "Portfolio draft not found." }, { status: 404 });
  }

  if (authorization.session.role === "FREELANCER" && existingDraft.freelancerName !== authorization.session.displayName) {
    return NextResponse.json({ ok: false, error: "You do not have access to this portfolio draft." }, { status: 403 });
  }

  const draft = await updatePortfolioDraft(body.draftId, {
    workScope: body.workScope,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    price: typeof body.price === "number" ? body.price : typeof body.price === "string" && body.price.trim() ? Number(body.price) : undefined,
    deliveryTime: typeof body.deliveryTime === "string" ? body.deliveryTime : undefined,
    category: typeof body.category === "string" ? body.category : undefined,
    summary: typeof body.summary === "string" ? body.summary : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : typeof body.tags === "string" ? body.tags.split(",") : undefined,
    seoTitle: typeof body.seoTitle === "string" ? body.seoTitle : undefined,
    seoDescription: typeof body.seoDescription === "string" ? body.seoDescription : undefined,
    showcasePlacement: body.showcasePlacement,
    youtubeTitle: typeof body.youtubeTitle === "string" ? body.youtubeTitle : undefined,
    youtubeDescription: typeof body.youtubeDescription === "string" ? body.youtubeDescription : undefined,
    youtubePrivacy: body.youtubePrivacy,
    youtubeCategoryId: typeof body.youtubeCategoryId === "string" ? body.youtubeCategoryId : undefined,
    youtubeTags: Array.isArray(body.youtubeTags) ? body.youtubeTags.map(String) : typeof body.youtubeTags === "string" ? body.youtubeTags.split(",") : undefined,
    audienceMadeForKids: typeof body.audienceMadeForKids === "boolean" ? body.audienceMadeForKids : undefined,
    sourceVideoPlatform: body.sourceVideoPlatform,
    sourceVideoUrl: typeof body.sourceVideoUrl === "string" ? body.sourceVideoUrl : undefined,
    sourceVideoEmbedUrl: typeof body.sourceVideoEmbedUrl === "string" ? body.sourceVideoEmbedUrl : body.sourceVideoEmbedUrl === null ? null : undefined,
  });

  if (!draft) {
    return NextResponse.json({ ok: false, error: "Portfolio draft not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    draft,
  });
}
