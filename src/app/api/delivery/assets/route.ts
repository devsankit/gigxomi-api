import { NextResponse } from "next/server";

import { freelancerCanAccessConversation } from "@/lib/api/conversation-access";
import { requireSessionRole } from "@/lib/api/require-session-role";
import type { AppRole } from "@/lib/auth/types";
import { createDeliveryAsset, listDeliveryAssets, listPublishJobs } from "@/lib/gigxomi/delivery-portfolio-store";
import type { YouTubePublishJob } from "@/lib/gigxomi/delivery-portfolio-types";

function filterAssetsForSession<T extends { id: string; assignedFreelancerName: string | null }>(
  items: T[],
  session: { role: AppRole; displayName: string },
) {
  if (session.role !== "FREELANCER") {
    return items;
  }

  return items.filter((item) => item.assignedFreelancerName === session.displayName);
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const [assets, publishJobs] = await Promise.all([listDeliveryAssets(), listPublishJobs()]);
  const visibleAssets = filterAssetsForSession(assets, {
    role: authorization.session.role,
    displayName: authorization.session.displayName,
  });
  const visibleAssetIds = new Set(visibleAssets.map((asset) => asset.id));

  return NextResponse.json({
    ok: true,
    assets: visibleAssets,
    publishJobs: publishJobs.filter((job: YouTubePublishJob) => visibleAssetIds.has(job.assetId)),
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ ok: false, error: "Upload the final delivery video as multipart form data." }, { status: 400 });
  }

  let conversationId = "";
  let title = "";
  let note = "";
  let uploadedFile: File | null = null;

  const formData = await request.formData();
  conversationId = String(formData.get("conversationId") ?? "").trim();
  title = String(formData.get("title") ?? "").trim();
  note = String(formData.get("note") ?? "").trim();
  const file = formData.get("file");
  if (file instanceof File) {
    uploadedFile = file;
  }

  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "conversationId is required." }, { status: 400 });
  }

  if (!uploadedFile) {
    return NextResponse.json({ ok: false, error: "A delivery video file is required." }, { status: 400 });
  }

  if (authorization.session.role === "FREELANCER" && !(await freelancerCanAccessConversation(authorization.session, conversationId))) {
    return NextResponse.json({ ok: false, error: "You do not have access to this conversation." }, { status: 403 });
  }

  const asset = await createDeliveryAsset({
    conversationId,
    title: title || undefined,
    fileName: uploadedFile.name,
    mimeType: uploadedFile.type || "video/mp4",
    sizeBytes: uploadedFile.size,
    note: note || undefined,
    uploadedByRole: authorization.session.role,
    uploadedByName: authorization.session.displayName,
    fileBuffer: await uploadedFile.arrayBuffer(),
  });

  if (!asset) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    asset,
  });
}
