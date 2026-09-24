import { getPublicAuthIntentById, markPublicAuthIntentOtpIssued } from "@/lib/auth/public-auth-intent-store";
import { createPublicRedirect, sanitizePublicAuthError } from "@/lib/auth/public-redirect";
import { buildPublicAuthWhatsAppHref, getPublicAuthOtpChannelInfo, getPublicAuthOtpCommand } from "@/lib/auth/public-whatsapp";
import { createOtpChallenge, findUserByIdentifier, getOtpChallengeMode } from "@/lib/auth/store";

function getFallbackPath(flow: "LOGIN" | "SIGNUP", loginScope: "public" | "manager" | "super-admin") {
  if (loginScope === "manager") return "/manager-login";
  return flow === "SIGNUP" ? "/signup" : "/login";
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const intentId = String(formData.get("intentId") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  const rawLoginScope = String(formData.get("loginScope") ?? "").trim();
  const loginScope = rawLoginScope === "super-admin" || rawLoginScope === "manager" ? rawLoginScope : "public";

  try {
    const intent = intentId ? await getPublicAuthIntentById(intentId) : null;
    if (!intent) {
      return createPublicRedirect("/login", {
        error: "That OTP request expired. Start again and request a new code.",
      });
    }
    if (loginScope === "super-admin") {
      return createPublicRedirect("/verify-otp", {
        intentId,
        redirectTo: intent.redirectTo ?? redirectTo,
        loginScope,
        error: "Super-admin WhatsApp OTP is disabled. Use the protected email and password.",
      });
    }

    const fallbackPath = getFallbackPath(intent.flow, loginScope);
    const user = await findUserByIdentifier(intent.phone);
    if (!user) {
      return createPublicRedirect(fallbackPath, {
        error: "No account matches that phone yet. Start again with the registered WhatsApp number.",
        identifier: intent.phone,
        redirectTo: intent.redirectTo ?? redirectTo,
      });
    }
    if (loginScope === "manager" && user.role !== "MANAGER") {
      return createPublicRedirect(fallbackPath, {
        error: "Only manager accounts can request OTP from the manager login page.",
        identifier: intent.phone,
        redirectTo: intent.redirectTo ?? redirectTo,
      });
    }

    const challenge = await createOtpChallenge(intent.phone);
    if (!challenge) {
      return createPublicRedirect("/verify-otp", {
        intentId,
        redirectTo: intent.redirectTo ?? redirectTo,
        loginScope,
        error: "We could not request your OTP right now. Please try again.",
      });
    }
    await markPublicAuthIntentOtpIssued({
      intentId: intent.id,
      challengeId: challenge.challengeId,
      userId: challenge.user.id,
    });

    const isTestOrLocal = process.env.NODE_ENV !== "production" || challenge.deliveryMode === "local-only";

    return createPublicRedirect("/verify-otp", {
      challengeId: challenge.challengeId,
      intentId: intent.id,
      redirectTo: intent.redirectTo ?? redirectTo,
      identifier: intent.phone,
      loginScope,
      otpMode: challenge.usesStaticOtp ? "preconfigured-code" : undefined,
      message: challenge.usesStaticOtp
        ? "Enter the permanent code configured for this agency account."
        : "A fresh 6-digit OTP code has been sent to your WhatsApp number.",
      otpHint: (challenge as { testCode?: string; otpCode?: string }).testCode ?? (isTestOrLocal ? (challenge as { testCode?: string; otpCode?: string }).otpCode : undefined),
    });
  } catch (error) {
    console.error("OTP request failed", error);
    return createPublicRedirect("/verify-otp", {
      intentId,
      redirectTo,
      loginScope,
      error: sanitizePublicAuthError(error, "We could not request your OTP right now. Please try again."),
    });
  }
}
