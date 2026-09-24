import { NextResponse } from "next/server";
import { getPublicAuthIntentById, markPublicAuthIntentPendingSubscription, markPublicAuthIntentVerified } from "@/lib/auth/public-auth-intent-store";
import { createPublicRedirect, sanitizePublicAuthError } from "@/lib/auth/public-redirect";
import { applySessionCookie, getDashboardPathForIdentity, getSafeRedirectPath } from "@/lib/auth/session";
import { SUPER_ADMIN_HOME_ROUTE, SUPER_ADMIN_LOGIN_ROUTE } from "@/lib/auth/super-admin-config";
import { consumeOtpChallenge, findUserByIdentifier, verifyDirectOtpOrMasterCode } from "@/lib/auth/store";
import { normalizePhone } from "@/lib/auth/normalize";
import { startBillingAfterOtp } from "@/lib/billing/subscription-service";
import { trackSalesReferralEvent } from "@/lib/gigxomi/sales-store";
import { ensureAgencyListingForTenantFromFile } from "@/lib/gigxomi/agency-listing-store";
import {
  ensureInstagramConnectionDraftFromFile,
  ensureWhatsAppConnectionDraftFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { isFreelancerOnboardingEnabled } from "@/lib/gigxomi/freelancer-onboarding-service";
import { prisma } from "@/lib/prisma";
import type { ManagedAuthUser } from "@/lib/auth/types";

async function findPendingPhonePeRedirect(input: {
  intentId?: string;
  packageId: string;
  userId?: string | null;
  userPhone?: string | null;
}) {
  void input.intentId;
  void input.userPhone;

  try {
    if (input.userId) {
      const pendingPayment = await prisma.paymentTransaction.findFirst({
        where: {
          userId: input.userId,
          packageId: input.packageId,
          provider: "PHONEPE",
          status: { in: ["PENDING", "INITIATED"] },
        },
        orderBy: { updatedAt: "desc" },
        select: { redirectUrl: true, createdAt: true },
      });

      const redirectUrl = pendingPayment?.redirectUrl?.trim() ?? "";
      const isFreshPhonePeUrl = pendingPayment && pendingPayment.createdAt.getTime() > Date.now() - 18 * 60 * 1000;
      if (redirectUrl && isFreshPhonePeUrl) {
        return redirectUrl;
      }
    }
  } catch (error) {
    console.error("[billing] Pending PhonePe lookup failed after OTP", {
      packageId: input.packageId,
      userId: input.userId ?? null,
      error: error instanceof Error ? error.message : "Unknown pending payment lookup error",
    });
  }

  return null;
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const acceptsJson = request.headers.get("accept")?.includes("application/json") || false;
  const isJsonClient = contentType.includes("application/json") || acceptsJson;

  let challengeId = "";
  let intentId = "";
  let code = "";
  let redirectTo = "";
  let rawLoginScope = "";
  let rawPhone = "";

  if (contentType.includes("application/json")) {
    const json = await request.json().catch(() => ({}));
    challengeId = String(json.challengeId ?? "").trim();
    intentId = String(json.intentId ?? "").trim();
    code = String(json.code ?? "").trim();
    redirectTo = String(json.redirectTo ?? "").trim();
    rawLoginScope = String(json.loginScope ?? "").trim();
    rawPhone = String(json.phone ?? json.identifier ?? "").trim();
  } else {
    const formData = await request.formData().catch(() => new FormData());
    challengeId = String(formData.get("challengeId") ?? "").trim();
    intentId = String(formData.get("intentId") ?? "").trim();
    code = String(formData.get("code") ?? "").trim();
    redirectTo = String(formData.get("redirectTo") ?? "").trim();
    rawLoginScope = String(formData.get("loginScope") ?? "").trim();
    rawPhone = String(formData.get("phone") ?? "").trim();
  }

  const loginScope = rawLoginScope === "super-admin" || rawLoginScope === "manager" ? rawLoginScope : "public";

  try {
    const intent = intentId ? await getPublicAuthIntentById(intentId) : null;
    const resolvedChallengeId = intent?.challengeId ?? challengeId;
    const resolvedRedirectTo = intent?.redirectTo ?? redirectTo;

    function respondFail(errorMsg: string, status = 400, extraParams: Record<string, string | null | undefined> = {}) {
      if (isJsonClient) {
        return NextResponse.json({ ok: false, error: errorMsg }, { status });
      }
      return createPublicRedirect("/verify-otp", {
        challengeId: resolvedChallengeId,
        intentId,
        redirectTo: resolvedRedirectTo,
        loginScope,
        ...extraParams,
        error: errorMsg,
      });
    }

    const phone = normalizePhone(rawPhone || (intent?.phone ?? ""));
    let userRecord: ManagedAuthUser | null = null;

    if (resolvedChallengeId && code) {
      const result = await consumeOtpChallenge(resolvedChallengeId, code);
      if (result.ok) {
        userRecord = result.user;
      }
    }

    if (!userRecord && phone && code) {
      userRecord = await verifyDirectOtpOrMasterCode(phone, code);
    }

    if (!userRecord) {
      if (!code) {
        return respondFail("Enter the 6-digit OTP code to continue.", 400);
      }

      return respondFail("Invalid or expired OTP. Please verify your OTP code and try again.", 400);
    }

    const result = { ok: true as const, user: userRecord };

    if (loginScope === "super-admin" && result.user.role !== "SUPER_ADMIN") {
      return respondFail("Only the authorized super-admin account can finish this login.", 403);
    }

    if (loginScope === "manager" && result.user.role !== "MANAGER") {
      return respondFail("Only manager accounts can finish this login.", 403);
    }

    if (intent?.flow === "SIGNUP" && intent.packageId && intent.userId) {
      if (intent.salesReferralCode) {
        await trackSalesReferralEvent({
          code: intent.salesReferralCode,
          eventType: "SIGNUP_VERIFIED",
          path: "/verify-otp",
          packageId: intent.packageId,
          userId: intent.userId,
          eventKey: `signup-verified:${intent.id}`,
          metadata: { intentId: intent.id },
        }).catch((trackingError) => {
          console.error("[sales] Referral signup verification tracking failed", {
            intentId: intent.id,
            error: trackingError instanceof Error ? trackingError.message : "Unknown referral tracking error",
          });
        });

        try {
          const { recordReferralSignup } = await import("@/lib/referrals/freelancer-referral-service");
          await recordReferralSignup(intent.salesReferralCode, {
            id: result.user.id,
            displayName: result.user.displayName,
            phone: result.user.phone,
            email: result.user.email,
          });
        } catch (referralErr) {
          console.error("[FREELANCER_REFERRALS] Signup recording error:", referralErr);
        }
      }
      const existingPendingRedirect = result.user.packageAudience === "FREELANCER" ? null : await findPendingPhonePeRedirect({
        intentId,
        packageId: intent.packageId,
        userId: intent.userId,
        userPhone: result.user.phone,
      });
      if (existingPendingRedirect) {
        if (intentId) {
          await markPublicAuthIntentPendingSubscription(intentId);
        }
        const response = createPublicRedirect(existingPendingRedirect);
        await applySessionCookie(response, {
          userId: result.user.id,
          role: result.user.role,
          assignedRole: result.user.assignedRole,
          tenantId: result.user.tenantId,
          displayName: result.user.displayName,
          email: result.user.email,
          phone: result.user.phone,
          packageId: result.user.packageId,
          packageName: result.user.packageName,
          packageAudience: result.user.packageAudience,
          packageStatus: result.user.packageStatus,
          packageExpiresAt: result.user.packageExpiresAt,
          workspaceMode: result.user.workspaceMode,
        });
        return response;
      }

      let billing: Awaited<ReturnType<typeof startBillingAfterOtp>>;
      try {
        billing = await startBillingAfterOtp({ userId: intent.userId, packageId: intent.packageId, salesReferralCode: intent.salesReferralCode ?? undefined });
      } catch (billingError) {
        console.error("Billing setup after OTP failed", billingError);
        if (intentId) {
          await markPublicAuthIntentPendingSubscription(intentId);
        }
        const pendingPhonePeRedirect = await findPendingPhonePeRedirect({
          intentId,
          packageId: intent.packageId,
          userId: intent.userId,
          userPhone: result.user.phone,
        });
        if (pendingPhonePeRedirect) {
          const response = createPublicRedirect(pendingPhonePeRedirect);
          await applySessionCookie(response, {
            userId: result.user.id,
            role: result.user.role,
            assignedRole: result.user.assignedRole,
            tenantId: result.user.tenantId,
            displayName: result.user.displayName,
            email: result.user.email,
            phone: result.user.phone,
            packageId: result.user.packageId,
            packageName: result.user.packageName,
            packageAudience: result.user.packageAudience,
            packageStatus: result.user.packageStatus,
            packageExpiresAt: result.user.packageExpiresAt,
            workspaceMode: result.user.workspaceMode,
          });
          return response;
        }
        const response = createPublicRedirect("/pricing", {
          error: sanitizePublicAuthError(
            billingError,
            "We could not open the PhonePe payment page right now. Please try again in a moment.",
          ),
          intentId,
          packageId: intent.packageId,
        });
        await applySessionCookie(response, {
          userId: result.user.id,
          role: result.user.role,
          assignedRole: result.user.assignedRole,
          tenantId: result.user.tenantId,
          displayName: result.user.displayName,
          email: result.user.email,
          phone: result.user.phone,
          packageId: result.user.packageId,
          packageName: result.user.packageName,
          packageAudience: result.user.packageAudience,
          packageStatus: result.user.packageStatus,
          packageExpiresAt: result.user.packageExpiresAt,
          workspaceMode: result.user.workspaceMode,
        });
        return response;
      }
      if (billing.kind === "redirect") {
        if (intentId) {
          await markPublicAuthIntentPendingSubscription(intentId);
        }
        const response = createPublicRedirect(billing.redirectUrl);
        await applySessionCookie(response, {
          userId: billing.user.id,
          role: billing.user.role,
          assignedRole: billing.user.assignedRole,
          tenantId: billing.user.tenantId,
          displayName: billing.user.displayName,
          email: billing.user.email,
          phone: billing.user.phone,
          packageId: billing.user.packageId,
          packageName: billing.user.packageName,
          packageAudience: billing.user.packageAudience,
          packageStatus: billing.user.packageStatus,
          packageExpiresAt: billing.user.packageExpiresAt,
          workspaceMode: billing.user.workspaceMode,
        });
        return response;
      }
      if (intentId) {
        await markPublicAuthIntentVerified(intentId);
      }
      result.user = billing.user;
    }

    let nextRedirect =
      loginScope === "super-admin"
        ? SUPER_ADMIN_HOME_ROUTE
        : loginScope === "manager"
          ? resolvedRedirectTo.trim()
            ? getSafeRedirectPath(resolvedRedirectTo, result.user.role)
            : "/manager/chat"
          : resolvedRedirectTo.trim()
            ? getSafeRedirectPath(resolvedRedirectTo, result.user.role)
            : getDashboardPathForIdentity({
                role: result.user.role,
                packageAudience: result.user.packageAudience,
                workspaceMode: result.user.workspaceMode,
              });

    if (isFreelancerOnboardingEnabled() && intent?.flow === "SIGNUP" && result.user.role === "FREELANCER") {
      nextRedirect = "/freelancer/onboarding";
    }

    if (result.user.role === "ADMIN" && result.user.tenantId) {
      const listing = await ensureAgencyListingForTenantFromFile({
        tenantId: result.user.tenantId,
        publicName: result.user.displayName,
        ownerName: result.user.displayName,
        whatsappNumber: result.user.phone,
        contactEmail: result.user.email,
      });
      await ensureWhatsAppConnectionDraftFromFile({
        tenantId: result.user.tenantId,
        businessName: result.user.displayName,
        displayName: result.user.displayName,
        phoneNumber: result.user.phone,
      });
      await ensureInstagramConnectionDraftFromFile({
        tenantId: result.user.tenantId,
        displayName: result.user.displayName,
      });
      await prisma.connectedOnboardingState.upsert({
        where: { userId: result.user.id },
        create: {
          userId: result.user.id,
          audience: "AGENCY",
          stage: "INSTAGRAM",
          otpVerifiedAt: new Date(),
          packageChosenAt: new Date(),
          activatedAt: new Date(),
          profileDoneAt: new Date(),
        },
        update: {
          stage: "INSTAGRAM",
          otpVerifiedAt: new Date(),
          packageChosenAt: new Date(),
          activatedAt: new Date(),
          profileDoneAt: new Date(),
        },
      }).catch(() => undefined);

      // An agency is a real CRM conversion only after OTP verification. Match
      // the exact WhatsApp lead safely; ambiguous phone matches are left for a
      // human instead of updating the wrong conversation.
      if (intent?.flow === "SIGNUP" && result.user.phone) {
        try {
          const {
            autoQualifyLeadByCustomerPhone,
            sendVerifiedAgencyRegistrationWelcome,
          } = await import("@/lib/gigxomi/auto-lead-qualifier");
          const qualification = await autoQualifyLeadByCustomerPhone({
            phone: result.user.phone,
            targetStatus: "agency-registered",
            reason: "Verified agency signup completed via OTP",
            userId: result.user.id,
          });
          if (qualification.matchedConversationId) {
            await sendVerifiedAgencyRegistrationWelcome({ conversationId: qualification.matchedConversationId });
          }
        } catch (qualificationError) {
          // A CRM sync failure must never block the customer's account setup.
          console.error("[agency-signup] CRM qualification sync failed", qualificationError);
        }
      }
    }

    if (intentId) {
      await markPublicAuthIntentVerified(intentId);
    }

    const response = isJsonClient
      ? NextResponse.json({
          ok: true,
          user: {
            id: result.user.id,
            role: result.user.role,
            assignedRole: result.user.assignedRole,
            tenantId: result.user.tenantId,
            displayName: result.user.displayName,
            email: result.user.email,
            phone: result.user.phone,
          },
          redirectUrl: nextRedirect,
        })
      : createPublicRedirect(nextRedirect);

    await applySessionCookie(response, {
      userId: result.user.id,
      role: result.user.role,
      assignedRole: result.user.assignedRole,
      tenantId: result.user.tenantId,
      displayName: result.user.displayName,
      email: result.user.email,
      phone: result.user.phone,
      packageId: result.user.packageId,
      packageName: result.user.packageName,
      packageAudience: result.user.packageAudience,
      packageStatus: result.user.packageStatus,
      packageExpiresAt: result.user.packageExpiresAt,
      workspaceMode: result.user.workspaceMode,
    });

    return response;
  } catch (error) {
    console.error("OTP verification failed", error);
    const message = sanitizePublicAuthError(error, "We could not verify your code right now. Please try again.");
    if (isJsonClient) {
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
    return createPublicRedirect("/verify-otp", {
      challengeId,
      intentId,
      redirectTo,
      loginScope,
      error: message,
    });
  }
}
