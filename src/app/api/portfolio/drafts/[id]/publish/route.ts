import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  getDraftPublishSource,
  getPortfolioDraftById,
  getPortfolioDraftPublishReadiness,
  markDraftPublishFailed,
  markDraftPublished,
} from "@/lib/gigxomi/delivery-portfolio-store";
import { publishPlatformVideo } from "@/lib/gigxomi/platform-youtube";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const draft = await getPortfolioDraftById(id);
  if (!draft) {
    return NextResponse.json({ ok: false, error: "Portfolio draft not found." }, { status: 404 });
  }

  if (draft.freelancerName !== authorization.session.displayName) {
    return NextResponse.json({ ok: false, error: "You do not have access to this portfolio draft." }, { status: 403 });
  }

  const readiness = getPortfolioDraftPublishReadiness(draft);
  if (!readiness.approvalReady) {
    return NextResponse.json({ ok: false, error: "Agency approval is required before this video can be published." }, { status: 409 });
  }

  if (!readiness.metadataReady) {
    return NextResponse.json({ ok: false, error: "Complete the pricing, delivery, SEO, and public portfolio metadata before publishing." }, { status: 409 });
  }

  if (draft.sourceVideoUrl && draft.sourceVideoPlatform !== "UNKNOWN") {
    const publishedAt = new Date().toISOString();
    const outcome = await markDraftPublished(draft.id, {
      publishJobId: `external-${draft.id}`,
      videoId: draft.sourceVideoId ?? "",
      videoUrl: draft.sourceVideoUrl,
      publishedAt,
      platform: draft.sourceVideoPlatform,
      embedUrl: draft.sourceVideoEmbedUrl,
    });

    return NextResponse.json({
      ok: true,
      draft: outcome?.draft ?? draft,
      asset: outcome?.asset ?? null,
      publishJob: null,
    });
  }

  const source = await getDraftPublishSource(id);
  if (!source) {
    return NextResponse.json({ ok: false, error: "The uploaded source video could not be found." }, { status: 404 });
  }

  try {
    const publishJob = await publishPlatformVideo({
      jobId: source.asset.youtubePublishJobId,
      assetId: source.asset.id,
      draftId: draft.id,
      tenantId: draft.tenantId,
      conversationId: draft.conversationId,
      freelancerId: draft.freelancerId,
      freelancerName: draft.freelancerName,
      title: draft.youtubeTitle,
      description: draft.youtubeDescription,
      privacy: draft.youtubePrivacy,
      categoryId: draft.youtubeCategoryId || null,
      tags: draft.youtubeTags,
      madeForKids: draft.audienceMadeForKids,
      sourceFilePath: source.version.storagePath,
      sourceFileName: source.version.fileName,
      sourceMimeType: source.version.mimeType,
      sourceSizeBytes: source.version.sizeBytes,
      existingVideoId: draft.sourceVideoId,
    });

    const outcome = await markDraftPublished(draft.id, {
      publishJobId: publishJob.id,
      videoId: publishJob.videoId ?? "",
      videoUrl: publishJob.videoUrl ?? "",
      publishedAt: publishJob.publishedAt ?? new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      draft: outcome?.draft ?? draft,
      asset: outcome?.asset ?? source.asset,
      publishJob,
    });
  } catch (publishError) {
    const message = publishError instanceof Error ? publishError.message : "Unable to publish this video right now.";
    const publishJob = (publishError as { publishJob?: { id?: string } }).publishJob;
    if (publishJob?.id) {
      await markDraftPublishFailed(draft.id, {
        publishJobId: publishJob.id,
        error: message,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: message,
        publishJob: publishJob ?? null,
      },
      { status: 500 },
    );
  }
}
