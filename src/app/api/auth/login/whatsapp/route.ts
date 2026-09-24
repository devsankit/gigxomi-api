import { normalizePhone } from "@/lib/auth/normalize";
import { createPublicAuthIntent, markPublicAuthIntentOtpIssued } from "@/lib/auth/public-auth-intent-store";
import { createPublicRedirect, sanitizePublicAuthError } from "@/lib/auth/public-redirect";
import { buildPublicAuthWhatsAppHref, getPublicAuthOtpChannelInfo, getPublicAuthOtpCommand } from "@/lib/auth/public-whatsapp";
import { getDashboardPathForIdentity, getSafeRedirectPath } from "@/lib/auth/session";
import { SUPER_ADMIN_LOGIN_ROUTE } from "@/lib/auth/super-admin-config";
import { createOtpChallenge, findUserByIdentifier, getOtpChallengeMode } from "@/lib/auth/store";

export async function POST(request: Request) {
  const formData = await request.formData();
  const identifier = String(formData.get("identifier") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  const rawLoginScope = String(formData.get("loginScope") ?? "").trim();
  const loginScope = rawLoginScope === "super-admin" || rawLoginScope === "manager" ? rawLoginScope : "public";
  const loginPath = loginScope === "super-admin" ? SUPER_ADMIN_LOGIN_ROUTE : loginScope === "manager" ? "/manager-login" : "/login";

  try {
    if (loginScope === "super-admin") {
      return createPublicRedirect(SUPER_ADMIN_LOGIN_ROUTE, {
        error: "Super-admin WhatsApp OTP is disabled. Sign in with the protected owner email and password.",
      });
    }

    const normalizedPhone = normalizePhone(phone || identifier);
    if (!normalizedPhone) {
      return createPublicRedirect(loginPath, {
        error: "Enter the WhatsApp number where you want to receive your OTP.",
        identifier: phone || identifier,
      });
    }

    const resolvedUser = await findUserByIdentifier(normalizedPhone);
    if (!resolvedUser) {
      return createPublicRedirect(loginPath, {
        error: "No account matches that phone yet. Create your Gigxomi account first.",
        identifier: normalizedPhone,
        redirectTo,
      });
    }
    if (loginScope === "manager" && resolvedUser.role !== "MANAGER") {
      return createPublicRedirect(loginPath, {
        error: "Only manager accounts can request OTP from the manager login page.",
        identifier: normalizedPhone,
      });
    }

    const resolvedRedirectTo = redirectTo
      ? getSafeRedirectPath(redirectTo, resolvedUser.role)
      : getDashboardPathForIdentity({
          role: resolvedUser.role,
          packageAudience: resolvedUser.packageAudience,
          workspaceMode: resolvedUser.workspaceMode,
        });
    const intent = await createPublicAuthIntent({
      flow: "LOGIN",
      phone: normalizedPhone,
      redirectTo: resolvedRedirectTo,
      userId: resolvedUser.id,
    });

    const challengeMode = await getOtpChallengeMode(normalizedPhone);
    // Allow users and staff to enter OTP directly on verify-otp screen; retains requiresWhatsAppCommand / otpFallback: "whatsapp-command" compatibility
    const requiresWhatsAppCommand = false;

    const result = await createOtpChallenge(normalizedPhone);
    if (!result) {
      return createPublicRedirect(loginPath, {
        error: "We could not create the OTP challenge right now. Please try again.",
        identifier: normalizedPhone,
        redirectTo,
      });
    }
    await markPublicAuthIntentOtpIssued({
      intentId: intent.id,
      challengeId: result.challengeId,
      userId: result.user.id,
    });

    const isTestOrLocal = process.env.NODE_ENV !== "production" || result.deliveryMode === "local-only";

    return createPublicRedirect("/verify-otp", {
      challengeId: result.challengeId,
      intentId: intent.id,
      redirectTo: intent.redirectTo,
      identifier: intent.phone,
      loginScope,
      otpMode: result.usesStaticOtp ? "preconfigured-code" : undefined,
      message: result.usesStaticOtp
        ? "Enter the permanent code configured for this agency account."
        : "Enter the 6-digit OTP code sent to your WhatsApp number.",
      otpHint: (result as { testCode?: string; otpCode?: string }).testCode ?? (isTestOrLocal ? (result as { testCode?: string; otpCode?: string }).otpCode : undefined),
    });
  } catch (error) {
    console.error("Public WhatsApp login failed", error);
    return createPublicRedirect(loginPath, {
      error: sanitizePublicAuthError(error, "We could not start login right now. Please try again in a moment."),
    });
  }
}
