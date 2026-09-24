import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getServiceByIdFromFile, submitFreelancerServiceForReviewFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

function getServiceSubmissionMissingFields(service: Awaited<ReturnType<typeof getServiceByIdFromFile>>) {
  if (!service) {
    return ["service"];
  }

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
  const hasMedia =
    Boolean(service.sampleVideoUrl?.trim()) ||
    Boolean(service.sampleVideoEmbedUrl?.trim()) ||
    service.media.some((media) => media.sourceUrl?.trim() || media.embedUrl?.trim());
  if (!hasMedia) missing.push("portfolio sample");

  return missing;
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const existingService = await getServiceByIdFromFile(id);
  if (!existingService) {
    return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
  }

  const isExistingOwner =
    existingService.ownerId === authorization.session.userId ||
    (authorization.session.displayName && existingService.ownerName.toLowerCase() === authorization.session.displayName.toLowerCase());

  if (authorization.session.role === "FREELANCER" && !isExistingOwner) {
    return NextResponse.json({ ok: false, error: "You do not have access to this service." }, { status: 403 });
  }

  const missingFields = getServiceSubmissionMissingFields(existingService);
  if (missingFields.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `Complete these service fields before submitting: ${missingFields.join(", ")}.`,
        missingFields,
      },
      { status: 400 },
    );
  }

  const service = await submitFreelancerServiceForReviewFromFile(id);

  if (!service) {
    return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    service,
  });
}
