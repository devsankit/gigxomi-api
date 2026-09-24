import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getServiceByIdFromFile, setFreelancerServiceAvailabilityFromFile, upsertFreelancerServiceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const service = await getServiceByIdFromFile(id);

  if (!service) {
    return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
  }

  const isOwner =
    service.ownerId === authorization.session.userId ||
    (authorization.session.displayName && service.ownerName.toLowerCase() === authorization.session.displayName.toLowerCase());

  if (authorization.session.role === "FREELANCER" && !isOwner) {
    return NextResponse.json({ ok: false, error: "You do not have access to this service." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    service,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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

  const body = await request.json();
  const hasAvailabilityPatch = Object.prototype.hasOwnProperty.call(body ?? {}, "listingEnabled") || Object.prototype.hasOwnProperty.call(body ?? {}, "availability");
  if (hasAvailabilityPatch) {
    const listingEnabled =
      typeof body?.listingEnabled === "boolean" ? body.listingEnabled : undefined;
    const availability =
      body?.availability === "PAUSED" ? "PAUSED" : body?.availability === "ACTIVE" ? "ACTIVE" : undefined;

    const service = await setFreelancerServiceAvailabilityFromFile(id, {
      listingEnabled,
      availability,
    });
    if (!service) {
      return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      service,
    });
  }

  const service = await upsertFreelancerServiceFromFile({
    id,
    ownerId: existingService.ownerId,
    ownerName: existingService.ownerName,
    ownerAlias: existingService.ownerAlias,
    title: body.title,
    sampleVideoUrl: body.sampleVideoUrl,
    sampleVideoEmbedUrl: body.sampleVideoEmbedUrl,
    summary: body.summary,
    category: body.category,
    specialty: body.specialty,
    description: body.description,
    targetAudience: body.targetAudience,
    deliveryTime: body.deliveryTime,
    revisions: body.revisions,
    basePrice: body.basePrice,
    tags: body.tags,
    seoTitle: body.seoTitle,
    seoDescription: body.seoDescription,
    seoKeywords: body.seoKeywords,
    deliverables: body.deliverables,
    faq: body.faq,
  });

  return NextResponse.json({
    ok: true,
    service,
  });
}
