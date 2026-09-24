import { NextResponse } from "next/server";

import { toMobileSession } from "@/lib/auth/mobile-session";
import { getPublicAuthIntentById, markPublicAuthIntentPendingSubscription, markPublicAuthIntentVerified } from "@/lib/auth/public-auth-intent-store";
import { createSessionPayload } from "@/lib/auth/session";
import { consumeOtpChallenge } from "@/lib/auth/store";
import { createSessionToken } from "@/lib/auth/token";
import type { ManagedAuthUser } from "@/lib/auth/types";
import { startBillingAfterOtp } from "@/lib/billing/subscription-service";
import { isFreelancerOnboardingEnabled } from "@/lib/gigxomi/freelancer-onboarding-service";
import { companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";

type MobileSignupVerifyBody = {
  challengeId?: unknown;
  intentId?: unknown;
  code?: unknown;
};

function readBodyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

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

export async function POST(request: Request) {
  let body: MobileSignupVerifyBody;

  try {
    body = (await request.json()) as MobileSignupVerifyBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Send a valid JSON OTP verification body." }, { status: 400 });
  }

  const intentId = readBodyString(body.intentId);
  const code = readBodyString(body.code);
  const challengeId = readBodyString(body.challengeId);
  const intent = intentId ? await getPublicAuthIntentById(intentId) : null;
  const resolvedChallengeId = intent?.challengeId ?? challengeId;

  if (!intent || intent.flow !== "SIGNUP" || !intent.userId || !intent.packageId) {
    return NextResponse.json({ ok: false, error: "Start mobile signup again before verifying OTP." }, { status: 400 });
  }

  if (!resolvedChallengeId || !code) {
    return NextResponse.json({ ok: false, error: "Challenge ID and OTP code are required." }, { status: 400 });
  }

  const result = await consumeOtpChallenge(resolvedChallengeId, code);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  if (intent.salesReferralCode) {
    try {
      const { recordReferralSignup } = await import("@/lib/referrals/freelancer-referral-service");
      await recordReferralSignup(intent.salesReferralCode, {
        id: intent.userId,
        displayName: intent.displayName || "Agency Partner",
        phone: intent.phone,
        email: intent.email,
      });
    } catch (referralErr) {
      console.error("[FREELANCER_REFERRALS] Mobile signup recording error:", referralErr);
    }
  }

  const billing = await startBillingAfterOtp({
    userId: intent.userId,
    packageId: intent.packageId,
    salesReferralCode: intent.salesReferralCode ?? undefined,
  });

  if (billing.kind === "redirect") {
    await markPublicAuthIntentPendingSubscription(intent.id);
    const auth = await createMobileAuthPayload(billing.user);
    const paymentPath = billing.redirectUrl.startsWith("/") ? billing.redirectUrl : "/pricing";

    return NextResponse.json({
      ok: true,
      nextAction: "payment",
      paymentPath,
      paymentUrl: `${getAppBaseUrl()}${paymentPath}`,
      ...auth,
    });
  }

  await markPublicAuthIntentVerified(intent.id);
  const auth = await createMobileAuthPayload(billing.user);

  return NextResponse.json({
    ok: true,
    nextAction: isFreelancerOnboardingEnabled() && billing.user.role === "FREELANCER" ? "onboarding" : "tabs",
    ...auth,
  });
}
