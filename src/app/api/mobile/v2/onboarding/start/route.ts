import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/auth/normalize";
import { createPublicAuthIntent, markPublicAuthIntentOtpIssued } from "@/lib/auth/public-auth-intent-store";
import { validatePublicDisplayName } from "@/lib/auth/public-display-name";
import { beginPublicOtpSignup } from "@/lib/auth/store";
import { buildPublicAuthWhatsAppHref, getPublicAuthOtpChannelInfo, getPublicAuthOtpCommand } from "@/lib/auth/public-whatsapp";
import { isRegistrationPackageFree } from "@/lib/billing/package-billing";
import { ensurePersistedRegistrationPackage } from "@/lib/billing/package-service";
import { assertConnectedPlatformV2Enabled } from "@/lib/connected-platform/feature-flags";
import { listActiveRegistrationPackages } from "@/lib/gigxomi/public-growth-store";
import { prisma } from "@/lib/prisma";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
export async function POST(request: Request) {
  try {
    assertConnectedPlatformV2Enabled();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const audience = text(body?.role).toUpperCase() === "AGENCY" ? "AGENCY" : text(body?.role).toUpperCase() === "FREELANCER" ? "FREELANCER" : null;
    const displayName = `${text(body?.firstName)} ${text(body?.lastName)}`.trim() || text(body?.displayName);
    const email = text(body?.email).toLowerCase();
    const phone = normalizePhone(text(body?.phone));
    const nameValidation = validatePublicDisplayName(displayName);
    if (!audience) return NextResponse.json({ ok: false, error: "Choose Agency or Freelancer." }, { status: 400 });
    if (!nameValidation.ok) return NextResponse.json({ ok: false, error: nameValidation.error }, { status: 400 });
    if (!phone) return NextResponse.json({ ok: false, error: "Enter a valid WhatsApp number." }, { status: 400 });

    const packages = (await listActiveRegistrationPackages()).filter(
      (pkg) => pkg.audience === audience && pkg.isActive && pkg.allowRegistration !== false,
    );
    const provisional = packages.sort((left, right) => {
      if (audience === "FREELANCER" && Boolean(left.isFree) !== Boolean(right.isFree)) return left.isFree ? -1 : 1;
      return left.sortOrder - right.sortOrder;
    })[0];
    if (!provisional) return NextResponse.json({ ok: false, error: `No ${audience.toLowerCase()} registration package is active.` }, { status: 409 });
    await ensurePersistedRegistrationPackage(provisional);

    const signup = await beginPublicOtpSignup({
      displayName: nameValidation.value,
      phone,
      email,
      packageId: provisional.id,
      allowPackageChange: true,
    });
    if (!signup.ok) {
      return NextResponse.json({ ok: false, error: "error" in signup ? signup.error : "Unable to start registration.", conflict: "conflict" in signup ? signup.conflict : undefined }, { status: 409 });
    }
    if (signup.requiresWhatsAppCommand === true) {
      return NextResponse.json({ ok: false, error: "Connected onboarding could not initialize its OTP challenge." }, { status: 503 });
    }

    const intent = await prisma.$transaction(async (tx) => {
      await tx.connectedSignupIntent.updateMany({ where: { phone, status: "OTP_ISSUED" }, data: { status: "SUPERSEDED" } });
      const created = await tx.connectedSignupIntent.create({
        data: {
          phone,
          displayName: nameValidation.value,
          email: email || null,
          audience,
          provisionalPackageId: provisional.id,
          userId: signup.user.id,
          challengeId: signup.challengeId,
          expiresAt: new Date(signup.expiresAt),
        },
      });
      await tx.connectedOnboardingState.upsert({
        where: { userId: signup.user.id },
        create: { userId: signup.user.id, audience, stage: "OTP", payload: { provisionalPackageId: provisional.id } },
        update: { audience, stage: "OTP", payload: { provisionalPackageId: provisional.id } },
      });
      return created;
    });

    // The WhatsApp webhook uses the public intent as the authorization to
    // issue a fresh code after a customer opens the 24-hour service window.
    // Without this record v2 registrations reached WhatsApp but were rejected
    // as having no pending signup.
    const publicIntent = await createPublicAuthIntent({
      flow: "SIGNUP",
      phone,
      displayName: nameValidation.value,
      email,
      packageId: provisional.id,
      userId: signup.user.id,
    });

    const [otpChannel, whatsappHref] = await Promise.all([getPublicAuthOtpChannelInfo(), buildPublicAuthWhatsAppHref()]);
    const needsWhatsAppFallback = !signup.usesStaticOtp && process.env.NODE_ENV === "production" && signup.deliveryMode !== "whatsapp-sent";
    if (!needsWhatsAppFallback) {
      await markPublicAuthIntentOtpIssued({
        intentId: publicIntent.id,
        challengeId: signup.challengeId,
        userId: signup.user.id,
      });
    }
    return NextResponse.json({
      ok: true,
      intentId: intent.id,
      challengeId: signup.challengeId,
      phone,
      role: audience,
      deliveryMode: signup.deliveryMode,
      expiresAt: signup.expiresAt,
      testCode: signup.testCode,
      usesStaticOtp: signup.usesStaticOtp,
      otpFallback: needsWhatsAppFallback ? "whatsapp-command" : undefined,
      otpCommand: getPublicAuthOtpCommand(),
      otpChannelLabel: otpChannel.label,
      whatsappHref,
      packages: packages.map((pkg) => ({
        ...pkg,
        isFree: isRegistrationPackageFree(pkg),
        commissionOverridePercent: audience === "FREELANCER" ? 0 : pkg.commissionOverridePercent,
        zeroCommission: audience === "FREELANCER",
      })),
      message: needsWhatsAppFallback
        ? "Open WhatsApp and send Get OTP from this same number. We will send a fresh code there."
        : signup.usesStaticOtp
          ? "Use the configured Gigxomi OTP to continue."
          : signup.deliveryMode === "whatsapp-sent"
            ? "OTP sent on WhatsApp. Enter the 6-digit code to continue."
            : "OTP is ready. Enter the 6-digit code to continue.",
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to start registration." }, { status: 400 });
  }
}
