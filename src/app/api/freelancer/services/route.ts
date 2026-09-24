import { checkFreelancerInHouseRestrictions } from "@/lib/team/inhouse-editor-policy";
import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { assertPlanLimit } from "@/lib/billing/billing-access-service";
import { listAllServicesFromFile, listFreelancerServicesFromFile, upsertFreelancerServiceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const services =
    authorization.session.role === "FREELANCER"
      ? await listFreelancerServicesFromFile(authorization.session.userId, authorization.session.displayName)
      : await listAllServicesFromFile();

  return NextResponse.json({
    ok: true,
    services,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json();
  if (authorization.session.role === "FREELANCER") {
    const inHouse = await checkFreelancerInHouseRestrictions(authorization.session.userId);
    if (!inHouse.canCreateGigs) {
      return NextResponse.json(
        {
          ok: false,
          code: "GIG_CREATION_RESTRICTED",
          error: "Your agency has restricted gig creation. In-house editors cannot create public marketplace gigs.",
        },
        { status: 403 }
      );
    }

    if (body.status && body.status !== "Draft") {
      const currentServices = (await listFreelancerServicesFromFile(authorization.session.userId)).filter((s) => s.status !== "Draft");
      const limit = await assertPlanLimit({
        userId: authorization.session.userId,
        limitKey: "serviceLimit",
        currentCount: currentServices.length,
        label: "Freelancer service",
      });
      if (!limit.ok) {
        return NextResponse.json({ ok: false, error: limit.error, limit: "limit" in limit ? limit.limit : undefined }, { status: 402 });
      }
    }
  }

  const service = await upsertFreelancerServiceFromFile({
    ownerId: authorization.session.userId,
    ownerName: authorization.session.displayName,
    ownerAlias: authorization.session.displayName,
    status: body.status || "Draft",
    title: body.title,
    sampleVideoUrl: body.sampleVideoUrl,
    sampleVideoEmbedUrl: body.sampleVideoEmbedUrl,
    summary: body.summary,
    category: body.category || "Video Editing",
    specialty: body.specialty,
    primaryEditorCategory: body.primaryEditorCategory,
    secondaryEditorCategories: body.secondaryEditorCategories,
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
