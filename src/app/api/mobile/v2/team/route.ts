import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listPublicAgencyListingsFromFile } from "@/lib/gigxomi/agency-listing-store";
import { createTeamRequest, listFreelancerTeamRequests, listTenantTeamRequests } from "@/lib/gigxomi/app-team-flow-service";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  if (authorization.session.role === "FREELANCER") {
    const [result, agencyOwners, publicListings] = await Promise.all([
      listFreelancerTeamRequests(authorization.session),
      prisma.appAuthUser.findMany({
        where: {
          OR: [
            { role: "ADMIN" },
            { assignedRole: "ADMIN" },
            { workspaceMode: "AGENCY" },
          ],
          tenantId: { not: null },
        },
        select: {
          id: true,
          displayName: true,
          phone: true,
          tenantId: true,
          packageId: true,
        },
        orderBy: { displayName: "asc" },
        take: 50,
      }),
      listPublicAgencyListingsFromFile(),
    ]);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });

    const listingByTenant = new Map(publicListings.map((listing) => [listing.tenantId, listing]));
    const agencyList: Array<Record<string, unknown>> = [];
    const seenTenants = new Set<string>();

    for (const owner of agencyOwners) {
      const tenantId = owner.tenantId!;
      if (seenTenants.has(tenantId)) continue;
      seenTenants.add(tenantId);
      const listing = listingByTenant.get(tenantId);

      agencyList.push({
        id: owner.id,
        ownerUserId: owner.id,
        tenantId,
        publicName: listing?.publicName || owner.displayName || "Production Studio",
        slug: listing?.slug || tenantId,
        logoUrl: listing?.logoUrl || null,
        coverUrl: listing?.coverUrl || null,
        tagline: listing?.tagline || "Creative production agency working with top video editors.",
        description: listing?.description || `${owner.displayName || "This agency"} manages creator channels, commercial edits, and short-form video campaigns.`,
        niche: listing?.niche || "Video Production & Editing",
        categories: listing?.categories?.length ? listing.categories : ["Commercial", "YouTube Operations", "Short-Form"],
        specialties: listing?.specialties?.length ? listing.specialties : ["Reels & Shorts", "YouTube Editing", "Color Grading"],
        hiringStatus: listing?.hiringStatus || "Actively hiring editors",
        office: listing?.office || { city: "India", state: "", country: "India", hasOffice: false, isAddressPublic: false, publicOfficeAddress: "", officeHours: "Mon-Sat" },
        stats: listing?.stats || { completedOrders: 18, repeatClientPercent: 88, responseSlaMinutes: 25, activeEditors: 3, openOpportunities: 2 },
        reputation: listing?.reputation || { score: 95, band: "TRUSTED_STUDIO", label: "Verified Agency", reasons: [] },
        reviews: listing?.reviews?.slice(0, 3) || [{
          rating: 5,
          authorLabel: "Verified Creator",
          projectType: "Video Editing Retainer",
          comment: "Clear briefs, prompt milestone payouts, and great communication.",
          createdAt: new Date().toISOString(),
        }],
        serviceOffers: listing?.serviceOffers?.slice(0, 4) || [{
          id: `offer-${tenantId}`,
          title: "Video Editing Collaboration",
          summary: "Ongoing project editing with clear briefs and milestone payouts.",
          priceLabel: "₹2,000 - ₹15,000 / project",
          turnaround: "24-48 Hours",
        }],
      });
    }

    for (const listing of publicListings) {
      if (seenTenants.has(listing.tenantId)) continue;
      seenTenants.add(listing.tenantId);
      agencyList.push({
        id: listing.tenantId,
        ownerUserId: listing.tenantId,
        tenantId: listing.tenantId,
        publicName: listing.publicName,
        slug: listing.slug,
        logoUrl: listing.logoUrl,
        coverUrl: listing.coverUrl,
        tagline: listing.tagline,
        description: listing.description,
        niche: listing.niche,
        categories: listing.categories,
        specialties: listing.specialties,
        hiringStatus: listing.hiringStatus,
        office: listing.office,
        stats: listing.stats,
        reputation: listing.reputation,
        reviews: listing.reviews.slice(0, 3),
        serviceOffers: listing.serviceOffers.slice(0, 4),
      });
    }

    return NextResponse.json({ ok: true, mode: "FREELANCER", agencies: agencyList, requests: result.requests, memberships: result.memberships });
  }

  const tenantId = authorization.session.tenantId || "";
  if (!tenantId) return NextResponse.json({ ok: false, error: "Agency tenant is missing." }, { status: 409 });
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || "";
  const cursor = url.searchParams.get("cursor")?.trim() || "";
  const [team, freelancers] = await Promise.all([
    listTenantTeamRequests(authorization.session, tenantId),
    prisma.appAuthUser.findMany({
      where: {
        OR: [{ role: "FREELANCER" }, { assignedRole: "FREELANCER" }],
        ...(search ? { displayName: { contains: search, mode: "insensitive" } } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        freelancerTrustSnapshot: { select: { score: true, provisional: true, completedAssignments: true, nextAction: true } },
        freelancerOnboarding: { select: { primaryCategory: true, secondaryCategories: true, status: true } },
      },
      orderBy: { id: "asc" },
      take: 21,
    }),
  ]);
  if (!team.ok) return NextResponse.json({ ok: false, error: team.error }, { status: team.status });
  const hasMore = freelancers.length > 20;
  const page = freelancers.slice(0, 20);
  return NextResponse.json({
    ok: true,
    mode: "AGENCY",
    freelancers: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    requests: team.requests,
    memberships: team.memberships,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (authorization.session.role === "FREELANCER") {
    const requestKind = body?.requestKind === "WORK" ? "WORK" : "TEAM";
    const agencyUserId = typeof body?.agencyUserId === "string" ? body.agencyUserId.trim() : "";
    const agency = agencyUserId
      ? await prisma.appAuthUser.findFirst({
          where: {
            id: agencyUserId,
            OR: [{ role: "ADMIN" }, { assignedRole: "ADMIN" }, { workspaceMode: "AGENCY" }],
            tenantId: { not: null },
          },
        })
      : null;
    if (!agency?.tenantId) return NextResponse.json({ ok: false, error: "Agency was not found." }, { status: 404 });
    const existingMembership = await prisma.appTeamMembership.findUnique({ where: { tenantId_freelancerId: { tenantId: agency.tenantId, freelancerId: authorization.session.userId } } });
    if (existingMembership?.status === "ACTIVE") return NextResponse.json({ ok: false, error: "You are already part of this agency." }, { status: 409 });
    const duplicateCandidates = await prisma.appTeamRequest.findMany({ where: { tenantId: agency.tenantId, freelancerId: authorization.session.userId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    const duplicate = duplicateCandidates.find((item) => {
      const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : {};
      return (metadata.requestKind === "WORK" ? "WORK" : "TEAM") === requestKind;
    });
    if (duplicate) return NextResponse.json({ ok: true, request: duplicate, duplicate: true });
    const defaultMessage = requestKind === "WORK"
      ? `I am available for ${typeof body?.roleType === "string" ? body.roleType.trim() || "freelance editing" : "freelance editing"} work and would like to be considered for a project.`
      : "I would like to join your Gigxomi agency team.";
    const requestRecord = await prisma.appTeamRequest.create({ data: {
      id: randomUUID(), tenantId: agency.tenantId, agencyUserId: agency.id, agencyName: agency.displayName,
      freelancerId: authorization.session.userId, freelancerName: authorization.session.displayName,
      roleType: typeof body?.roleType === "string" ? body.roleType.trim() || "Freelancer" : "Freelancer",
      message: typeof body?.message === "string" ? body.message.trim() || defaultMessage : defaultMessage,
      offeredTerms: "", status: "PENDING", expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), metadata: { initiatedBy: "FREELANCER", requestKind },
    } });
    await createAppNotification({
      userId: agency.id,
      tenantId: agency.tenantId,
      type: requestKind === "WORK" ? "freelancer_work_interest" : "team_application_received",
      title: requestKind === "WORK" ? "Freelancer is available for work" : "Freelancer applied to your agency",
      message: requestKind === "WORK" ? `${authorization.session.displayName} asked to be considered for your next project.` : `${authorization.session.displayName} wants to join your team.`,
      entityType: "team_request",
      entityId: requestRecord.id,
    });
    return NextResponse.json({ ok: true, request: requestRecord, duplicate: false });
  }
  if (!authorization.session.tenantId) return NextResponse.json({ ok: false, error: "Agency tenant is missing." }, { status: 409 });
  const result = await createTeamRequest(authorization.session, authorization.session.tenantId, body ?? {});
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, request: result.request, duplicate: result.duplicate });
}
