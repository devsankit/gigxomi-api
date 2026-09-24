import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { createStaleMobileSessionResponse, isMissingMobileSessionUserError, rejectMissingMobileSessionUser } from "@/lib/api/mobile-session-user";
import { normalizePhone } from "@/lib/auth/normalize";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { createConnectedMobileAuthPayload } from "@/lib/connected-platform/mobile-auth";
import { getManagedUserForSession, startBillingAfterOtp } from "@/lib/billing/subscription-service";
import { findLaunchRegistrationPackage } from "@/lib/gigxomi/public-growth-store";
import { prisma } from "@/lib/prisma";
import { companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";
import { createBillingCheckoutIntent } from "@/lib/billing/checkout-intent";
import { classifyPhonePeCheckoutError, phonePeMobileError } from "@/lib/billing/phonepe-checkout-errors";
import { recordPhonePeProviderDiagnostic } from "@/lib/billing/phonepe-admin-config-service";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function resolveVerifiedState(userId: string, phone: string | null) {
  const direct = await prisma.connectedOnboardingState.findUnique({ where: { userId } });
  if (direct?.otpVerifiedAt) return direct;
  const normalizedPhone = normalizePhone(phone ?? "");
  if (!normalizedPhone) return direct;
  const intent = await prisma.connectedSignupIntent.findFirst({
    where: { phone: normalizedPhone, status: "VERIFIED", verifiedAt: { not: null } },
    orderBy: { verifiedAt: "desc" },
  });
  if (!intent) return direct;
  const source = await prisma.connectedOnboardingState.findUnique({ where: { userId: intent.userId } });
  if (!source?.otpVerifiedAt) return direct;
  if (intent.userId === userId) return source;
  return prisma.$transaction(async (tx) => {
    const repaired = await tx.connectedOnboardingState.upsert({
      where: { userId },
      create: {
        userId,
        audience: source.audience,
        stage: source.stage,
        otpVerifiedAt: source.otpVerifiedAt,
        packageChosenAt: source.packageChosenAt,
        activatedAt: source.activatedAt,
        profileDoneAt: source.profileDoneAt,
        completedAt: source.completedAt,
        payload: (source.payload ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        audience: source.audience,
        stage: source.stage,
        otpVerifiedAt: source.otpVerifiedAt,
        packageChosenAt: source.packageChosenAt,
        activatedAt: source.activatedAt,
        profileDoneAt: source.profileDoneAt,
        completedAt: source.completedAt,
        payload: (source.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
    await tx.connectedSignupIntent.update({ where: { id: intent.id }, data: { userId } });
    await tx.connectedOnboardingState.deleteMany({ where: { userId: intent.userId } });
    return repaired;
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const staleSessionResponse = await rejectMissingMobileSessionUser(authorization.session.userId);
  if (staleSessionResponse) return staleSessionResponse;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const packageId = text(body?.packageId);
  const couponCode = text(body?.couponCode);
  const billingCycle = body?.billingCycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  const distributionChannel = body?.distributionChannel === "PLAY_READER" ? "PLAY_READER" : "DIRECT";
  const [state, pkg] = await Promise.all([
    resolveVerifiedState(authorization.session.userId, authorization.session.phone),
    findLaunchRegistrationPackage(packageId),
  ]);
  if (!state || !state.otpVerifiedAt) return NextResponse.json({ ok: false, error: "Verify OTP before selecting a package." }, { status: 409 });
  if (!pkg || !pkg.isActive || pkg.allowRegistration === false) return NextResponse.json({ ok: false, error: "Package is not available." }, { status: 404 });
  const expectedAudience = state.audience === "AGENCY" ? "AGENCY" : "FREELANCER";
  if (pkg.audience !== expectedAudience) return NextResponse.json({ ok: false, error: "Package does not match the selected registration role." }, { status: 400 });
  if (distributionChannel === "PLAY_READER" && Number(pkg.amount ?? 0) > 0) {
    return NextResponse.json({ ok: false, code: "READER_PURCHASE_UNAVAILABLE", error: "Complete your subscription on the Gigxomi website, then refresh access in this Play edition.", actions: ["REFRESH_ACCESS"] }, { status: 409 });
  }

  try {
    const cycleAmount =
      billingCycle === "YEARLY"
        ? Number(pkg.priceYearly ?? pkg.amount ?? 0)
        : Number(pkg.priceMonthly ?? pkg.amount ?? 0);
    if (!pkg.isFree && Number(pkg.amount ?? 0) > 0) {
      const checkoutIntent = createBillingCheckoutIntent({ userId: authorization.session.userId, packageId: pkg.id, billingCycle, returnTarget: "DIRECT_ANDROID", couponCode: couponCode || undefined });
      await prisma.connectedOnboardingState.update({ where: { userId: authorization.session.userId }, data: { stage: "PAYMENT", packageChosenAt: new Date(), payload: { packageId: pkg.id, couponCode: couponCode || null, billingCycle } } });
      const appBase = (process.env.APP_BASE_URL?.trim() || companyKnowledgeBase.siteUrl).replace(/\/+$/, "");
      const paymentPath = `/subscription-checkout?intent=${encodeURIComponent(checkoutIntent)}`;
      const user = await getManagedUserForSession(authorization.session.userId);
      return NextResponse.json({ ok: true, nextAction: "payment", paymentPath, paymentUrl: `${appBase}${paymentPath}`, pricing: { originalAmount: cycleAmount, discountAmount: 0, finalAmount: cycleAmount }, ...(await createConnectedMobileAuthPayload(user)) });
    }
    const billing = await startBillingAfterOtp({
      userId: authorization.session.userId,
      packageId: pkg.id,
      amountOverride: 0,
      billingCycle,
    });
    const nextStage = billing.kind === "redirect" ? "PAYMENT" : "PROFILE";
    await prisma.connectedOnboardingState.update({
      where: { userId: authorization.session.userId },
      data: {
        stage: nextStage,
        packageChosenAt: new Date(),
        activatedAt: billing.kind === "activated" ? new Date() : null,
        payload: { packageId: pkg.id, couponCode: null, billingCycle },
      },
    });
    const appBase = (process.env.APP_BASE_URL?.trim() || companyKnowledgeBase.siteUrl).replace(/\/+$/, "");
    return NextResponse.json({
      ok: true,
      nextAction: billing.kind === "redirect" ? "payment" : expectedAudience === "AGENCY" ? "agency-profile" : "freelancer-profile",
      paymentPath: billing.kind === "redirect" ? billing.redirectUrl : null,
      paymentUrl: billing.kind === "redirect" ? new URL(billing.redirectUrl, `${appBase}/`).toString() : null,
      pricing: { originalAmount: cycleAmount, discountAmount: 0, finalAmount: cycleAmount },
      ...(await createConnectedMobileAuthPayload(billing.user)),
    });
  } catch (error) {
    if (isMissingMobileSessionUserError(error)) return createStaleMobileSessionResponse();
    const requestId = crypto.randomUUID();
    const classified = classifyPhonePeCheckoutError(error);
    const details = phonePeMobileError(classified);
    await recordPhonePeProviderDiagnostic({ status: classified.toUpperCase(), requestId }).catch(() => undefined);
    return NextResponse.json(
      {
        ok: false,
        code: details.code,
        error: details.error,
        actions: details.actions,
        retryable: details.retryable,
        requestId,
      },
      { status: details.status },
    );
  }
}
