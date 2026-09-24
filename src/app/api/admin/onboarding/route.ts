import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { ensureAgencyListingForTenantFromFile, updateAgencyListingFromFile } from "@/lib/gigxomi/agency-listing-store";
import { getInstagramConnectionStateFromFile, getWhatsAppConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const tenantId = authorization.session.tenantId ?? "";
  if (!tenantId) return NextResponse.json({ ok: false, error: "Missing tenant context" }, { status: 400 });
  const [profile, igConn, waConn] = await Promise.all([
    ensureAgencyListingForTenantFromFile({
      tenantId,
      publicName: authorization.session.displayName ?? "Agency",
      ownerName: authorization.session.displayName,
      whatsappNumber: authorization.session.phone ?? "",
      contactEmail: authorization.session.email,
    }),
    getInstagramConnectionStateFromFile(tenantId).catch(() => null),
    getWhatsAppConnectionStateFromFile(tenantId).catch(() => null),
  ]);
  let activePlan = "Agency Freemium · 7-Day Free Trial";
  if (authorization.session.userId) {
    try {
      const sub = await prisma.userSubscription.findFirst({
        where: { userId: authorization.session.userId, status: { in: ["ACTIVE", "TRIALING"] } },
        include: { package: true },
        orderBy: { updatedAt: "desc" },
      });
      if (sub?.package?.name) {
        activePlan = `${sub.package.name}${sub.status === "TRIALING" ? " · Free Trial" : ""}`;
      }
    } catch {
      // ignore
    }
  }

  // A WhatsApp line is only genuinely connected if Meta has provisioned phoneNumberId and credentials
  const isWhatsAppConnected = Boolean(
    waConn &&
    waConn.pluginEnabled &&
    waConn.phoneNumberId?.trim() &&
    (waConn.accessToken?.trim() || waConn.status === "Ready for webhook")
  );

  // An Instagram account is only genuinely connected if Meta OAuth completed with accountId and accessToken
  const isInstagramConnected = Boolean(
    igConn &&
    igConn.pluginEnabled &&
    igConn.accountId?.trim() &&
    igConn.accessToken?.trim() &&
    igConn.status === "Connected"
  );

  return NextResponse.json({
    ok: true,
    completed: profile.isSetupComplete,
    completionPercent: profile.completionPercent,
    activePlan,
    agencyName: profile.publicName || authorization.session.displayName || "My Agency",
    isWhatsAppConnected,
    isInstagramConnected,
    hasWhatsApp: isWhatsAppConnected,
    hasInstagram: isInstagramConnected,
    hasWhatsAppPhone: Boolean(profile.whatsappNumber || waConn?.phoneNumber),
    hasInstagramDraft: Boolean(igConn?.username),
    profile,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json()) as {
    [key: string]: unknown;
    publicName?: unknown;
    name?: unknown;
    slug?: unknown;
    contactEmail?: unknown;
    whatsappNumber?: unknown;
    websiteUrl?: unknown;
    instagramHandle?: unknown;
    logoUrl?: unknown;
    coverUrl?: unknown;
    tagline?: unknown;
    publicPageTitle?: unknown;
    description?: unknown;
    publicPageDescription?: unknown;
    niche?: unknown;
    categories?: unknown[];
    specialties?: unknown[];
    ctaLabel?: unknown;
    hiringStatus?: unknown;
    office?: {
      city?: unknown;
      state?: unknown;
      country?: unknown;
      hasOffice?: unknown;
      officeVerified?: unknown;
      isAddressPublic?: unknown;
      publicOfficeAddress?: unknown;
      officeHours?: unknown;
    };
    showcaseEditorIds?: unknown[];
    serviceOffers?: Array<{ title?: unknown; priceLabel?: unknown; summary?: unknown } | null>;
    isPublished?: unknown;
  };
  const tenantId = authorization.session.tenantId ?? "";

  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Missing tenant context" }, { status: 400 });
  }

  await ensureAgencyListingForTenantFromFile({
    tenantId,
    publicName: authorization.session.displayName,
    ownerName: authorization.session.displayName,
    whatsappNumber: authorization.session.phone,
    contactEmail: authorization.session.email,
  });

  const updated = await updateAgencyListingFromFile(tenantId, {
    publicName: String(body.publicName ?? body.name ?? "").trim(),
    slug: String(body.slug ?? "").trim(),
    contactEmail: String(body.contactEmail ?? authorization.session.email ?? "").trim(),
    whatsappNumber: String(body.whatsappNumber ?? authorization.session.phone ?? "").trim(),
    websiteUrl: body.websiteUrl !== undefined ? String(body.websiteUrl).trim() : undefined,
    instagramHandle: body.instagramHandle !== undefined ? String(body.instagramHandle).trim() : undefined,
    logoUrl: body.logoUrl == null ? null : String(body.logoUrl).trim(),
    coverUrl: body.coverUrl == null ? null : String(body.coverUrl).trim(),
    tagline: String(body.tagline ?? body.publicPageTitle ?? "").trim(),
    description: String(body.description ?? body.publicPageDescription ?? "").trim(),
    niche: String(body.niche ?? "").trim(),
    categories: Array.isArray(body.categories) ? body.categories.map((value: unknown) => String(value)) : [],
    specialties: Array.isArray(body.specialties) ? body.specialties.map((value: unknown) => String(value)) : [],
    ctaLabel: String(body.ctaLabel ?? "Talk to agency").trim(),
    hiringStatus:
      body.hiringStatus === "Selective hiring" || body.hiringStatus === "Invite only" || body.hiringStatus === "Actively hiring"
        ? body.hiringStatus
        : "Actively hiring",
    office: {
      city: String(body.office?.city ?? "").trim(),
      state: String(body.office?.state ?? "").trim(),
      country: String(body.office?.country ?? "India").trim(),
      hasOffice: Boolean(body.office?.hasOffice),
      officeVerified: Boolean(body.office?.officeVerified),
      isAddressPublic: Boolean(body.office?.isAddressPublic),
      publicOfficeAddress: String(body.office?.publicOfficeAddress ?? "").trim(),
      officeHours: String(body.office?.officeHours ?? "").trim(),
    },
    showcaseEditorIds: Array.isArray(body.showcaseEditorIds) ? body.showcaseEditorIds.map((value: unknown) => String(value)) : [],
    serviceOffers: Array.isArray(body.serviceOffers)
      ? body.serviceOffers.map((offer: { title?: unknown; priceLabel?: unknown; summary?: unknown } | null) => ({
          title: String(offer?.title ?? "").trim(),
          priceLabel: String(offer?.priceLabel ?? "").trim(),
          summary: String(offer?.summary ?? "").trim(),
        }))
      : [],
    isPublished: Boolean(body.isPublished),
  });

  if (!updated) {
    return NextResponse.json({ ok: false, error: "Tenant not found" }, { status: 404 });
  }

  const publicName = String(body.publicName ?? body.name ?? "").trim();

  if (authorization.session.userId) {
    if (publicName) {
      await prisma.appAuthUser.update({
        where: { id: authorization.session.userId },
        data: { displayName: publicName },
      }).catch(() => null);
    }
    await prisma.connectedOnboardingState.updateMany({
      where: { userId: authorization.session.userId, audience: "AGENCY" },
      data: updated.isSetupComplete
        ? { stage: "COMPLETE", profileDoneAt: new Date(), completedAt: new Date() }
        : { stage: "PROFILE", profileDoneAt: null, completedAt: null },
    });
  }

  return NextResponse.json({
    ok: true,
    tenant: updated,
    profile: updated,
  });
}
