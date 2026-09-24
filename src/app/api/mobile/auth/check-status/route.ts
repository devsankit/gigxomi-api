import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/auth/normalize";
import { toMobileSession } from "@/lib/auth/mobile-session";
import {
  getLatestActivePublicAuthIntentByPhone,
  getPublicAuthIntentById,
  markPublicAuthIntentPendingSubscription,
  markPublicAuthIntentVerified,
} from "@/lib/auth/public-auth-intent-store";
import { createSessionPayload } from "@/lib/auth/session";
import { findUserByIdentifier } from "@/lib/auth/store";
import { createSessionToken } from "@/lib/auth/token";
import type { ManagedAuthUser } from "@/lib/auth/types";
import { isRegistrationPackageFree } from "@/lib/billing/package-billing";
import { startBillingAfterOtp } from "@/lib/billing/subscription-service";
import { createConnectedMobileAuthPayload } from "@/lib/connected-platform/mobile-auth";
import { isFreelancerOnboardingEnabled } from "@/lib/gigxomi/freelancer-onboarding-service";
import { listActiveRegistrationPackages } from "@/lib/gigxomi/public-growth-store";
import { prisma } from "@/lib/prisma";
import { companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL?.trim() || companyKnowledgeBase.siteUrl).replace(/\/+$/, "");
}

async function createMobileAuthPayload(user: ManagedAuthUser) {
  const session = createSessionPayload({
    userId: user.id,
    role: user.role,
    assignedRole: user.assignedRole,
    tenantId: user.tenantId,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    packageId: user.packageId,
    packageName: user.packageName,
    packageAudience: user.packageAudience,
    packageStatus: user.packageStatus,
    packageExpiresAt: user.packageExpiresAt,
    workspaceMode: user.workspaceMode,
  });
  const token = await createSessionToken(session);

  return {
    token,
    session: toMobileSession(session),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const intentId = searchParams.get("intentId")?.trim() || "";
  const phoneParam = searchParams.get("phone")?.trim() || "";
  const normalizedPhone = normalizePhone(phoneParam);

  // 1. Check ConnectedSignupIntent (V2 Mobile Onboarding Flow)
  let connectedIntent = intentId
    ? await prisma.connectedSignupIntent.findUnique({ where: { id: intentId } })
    : null;
  if (!connectedIntent && normalizedPhone) {
    connectedIntent = await prisma.connectedSignupIntent.findFirst({
      where: { phone: normalizedPhone },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (connectedIntent && (connectedIntent.status === "VERIFIED" || connectedIntent.verifiedAt)) {
    const user = await prisma.appAuthUser.findUnique({ where: { id: connectedIntent.userId } });
    if (user) {
      const packages = (await listActiveRegistrationPackages())
        .filter((pkg) => pkg.audience === connectedIntent.audience && pkg.isActive && pkg.allowRegistration !== false)
        .map((pkg) => ({
          ...pkg,
          isFree: isRegistrationPackageFree(pkg),
          commissionOverridePercent: connectedIntent.audience === "FREELANCER" ? 0 : pkg.commissionOverridePercent,
          zeroCommission: connectedIntent.audience === "FREELANCER",
        }));
      const auth = await createConnectedMobileAuthPayload(user as unknown as ManagedAuthUser);
      return NextResponse.json({
        ok: true,
        verified: true,
        nextAction: "package",
        packages,
        ...auth,
      });
    }
  }

  // 2. Check PublicAuthIntent (Legacy Flow)
  let intent = intentId ? await getPublicAuthIntentById(intentId) : null;
  if (!intent && normalizedPhone) {
    intent = await getLatestActivePublicAuthIntentByPhone(normalizedPhone);
  }

  // If publicIntent has whatsappVerifiedAt and connectedIntent is in OTP_ISSUED, mark connectedIntent verified
  if (
    intent &&
    (intent.status === "VERIFIED" || Boolean(intent.whatsappVerifiedAt)) &&
    connectedIntent &&
    connectedIntent.status === "OTP_ISSUED"
  ) {
    const verifiedAt = new Date();
    await prisma.connectedSignupIntent.update({
      where: { id: connectedIntent.id },
      data: { status: "VERIFIED", verifiedAt },
    });
    const user = await prisma.appAuthUser.findUnique({ where: { id: connectedIntent.userId } });
    if (user) {
      const packages = (await listActiveRegistrationPackages())
        .filter((pkg) => pkg.audience === connectedIntent.audience && pkg.isActive && pkg.allowRegistration !== false)
        .map((pkg) => ({
          ...pkg,
          isFree: isRegistrationPackageFree(pkg),
          commissionOverridePercent: connectedIntent.audience === "FREELANCER" ? 0 : pkg.commissionOverridePercent,
          zeroCommission: connectedIntent.audience === "FREELANCER",
        }));
      const auth = await createConnectedMobileAuthPayload(user as unknown as ManagedAuthUser);
      return NextResponse.json({
        ok: true,
        verified: true,
        nextAction: "package",
        packages,
        ...auth,
      });
    }
  }

  if (!intent) {
    if (connectedIntent) {
      return NextResponse.json({
        ok: true,
        verified: false,
        status: connectedIntent.status,
      });
    }
    return NextResponse.json({ ok: false, error: "Pending authentication intent not found." }, { status: 404 });
  }

  const isVerified = intent.status === "VERIFIED" || Boolean(intent.whatsappVerifiedAt);

  if (!isVerified) {
    return NextResponse.json({
      ok: true,
      verified: false,
      status: intent.status,
    });
  }

  // Handle verified LOGIN intent
  if (intent.flow === "LOGIN") {
    const user =
      (intent.userId ? await findUserByIdentifier(intent.userId) : null) ||
      (await findUserByIdentifier(intent.phone));

    if (!user) {
      return NextResponse.json({ ok: false, error: "User account not found for this intent." }, { status: 404 });
    }

    if (intent.status !== "VERIFIED") {
      await markPublicAuthIntentVerified(intent.id);
    }

    const auth = await createMobileAuthPayload(user);
    return NextResponse.json({
      ok: true,
      verified: true,
      ...auth,
    });
  }

  // Handle verified SIGNUP intent
  if (intent.flow === "SIGNUP" && intent.userId && intent.packageId) {
    const billing = await startBillingAfterOtp({
      userId: intent.userId,
      packageId: intent.packageId,
    });

    const audience =
      billing.user.packageAudience ||
      (billing.user.role === "ADMIN" || billing.user.role === "MANAGER" ? "AGENCY" : "FREELANCER");
    const packages = (await listActiveRegistrationPackages())
      .filter((pkg) => pkg.audience === audience && pkg.isActive && pkg.allowRegistration !== false)
      .map((pkg) => ({
        ...pkg,
        isFree: isRegistrationPackageFree(pkg),
        commissionOverridePercent: audience === "FREELANCER" ? 0 : pkg.commissionOverridePercent,
        zeroCommission: audience === "FREELANCER",
      }));

    if (billing.kind === "redirect") {
      await markPublicAuthIntentPendingSubscription(intent.id);
      const auth = await createMobileAuthPayload(billing.user);
      const paymentPath = billing.redirectUrl.startsWith("/") ? billing.redirectUrl : "/pricing";

      return NextResponse.json({
        ok: true,
        verified: true,
        nextAction: "package",
        paymentPath,
        paymentUrl: `${getAppBaseUrl()}${paymentPath}`,
        packages,
        ...auth,
      });
    }

    if (intent.status !== "VERIFIED") {
      await markPublicAuthIntentVerified(intent.id);
    }

    const auth = await createMobileAuthPayload(billing.user);
    return NextResponse.json({
      ok: true,
      verified: true,
      nextAction: isFreelancerOnboardingEnabled() && billing.user.role === "FREELANCER" ? "onboarding" : "tabs",
      packages,
      ...auth,
    });
  }

  return NextResponse.json({
    ok: true,
    verified: false,
    status: intent.status,
  });
}
