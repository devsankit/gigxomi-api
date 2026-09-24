import { beginPublicOtpSignup } from "@/lib/auth/store";
import { normalizePhone } from "@/lib/auth/normalize";
import { validatePublicDisplayName, validatePublicNamePart } from "@/lib/auth/public-display-name";
import { createPublicAuthIntent, markPublicAuthIntentOtpIssued } from "@/lib/auth/public-auth-intent-store";
import { createPublicRedirect, sanitizePublicAuthError } from "@/lib/auth/public-redirect";
import { getPublicAuthOtpChannelInfo, getPublicAuthOtpCommand } from "@/lib/auth/public-whatsapp";
import { getDashboardPathForIdentity, getSafeRedirectPath } from "@/lib/auth/session";
import { findLaunchRegistrationPackage } from "@/lib/gigxomi/public-growth-store";
import { trackSalesReferralEvent } from "@/lib/gigxomi/sales-store";

export async function POST(request: Request) {
  const formData = await request.formData();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const legacyDisplayName = String(formData.get("displayName") ?? "").trim();
  const displayName = firstName || lastName ? `${firstName} ${lastName}`.trim() : legacyDisplayName;
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const packageId = String(formData.get("packageId") ?? "").trim();
  const salesReferralCode = String(formData.get("ref") ?? "").trim();
  const confirmPackageChange = String(formData.get("confirmPackageChange") ?? "").trim() === "1";
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  const initialDisplayNameValidation = validatePublicDisplayName(displayName);

  try {
    if (!displayName || !phone || !packageId) {
      return createPublicRedirect("/signup", {
        error: "First name, last name, WhatsApp number, and package selection are required.",
        displayName,
        firstName,
        lastName,
        phone,
        email,
        packageId,
        redirectTo,
      });
    }

    if (firstName || lastName) {
      const firstNameValidation = validatePublicNamePart(firstName, "first name");
      const lastNameValidation = validatePublicNamePart(lastName, "last name");
      if (!firstNameValidation.ok || !lastNameValidation.ok) {
        return createPublicRedirect("/signup", {
          error: !firstNameValidation.ok ? firstNameValidation.error : !lastNameValidation.ok ? lastNameValidation.error : "Enter your first and last name.",
          displayName,
          firstName,
          lastName,
          phone,
          email,
          packageId,
          redirectTo,
        });
      }
    }

    if (!initialDisplayNameValidation.ok) {
      return createPublicRedirect("/signup", {
        error: initialDisplayNameValidation.error,
        displayName,
        firstName,
        lastName,
        phone,
        email,
        packageId,
        redirectTo,
      });
    }

    const normalizedDisplayName = initialDisplayNameValidation.value;
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return createPublicRedirect("/signup", {
        error: "Enter a valid WhatsApp number to continue.",
        displayName: normalizedDisplayName,
        firstName,
        lastName,
        phone,
        email,
        packageId,
        redirectTo,
      });
    }

    const selectedPackage = await findLaunchRegistrationPackage(packageId);
    if (!selectedPackage || !selectedPackage.isActive) {
      return createPublicRedirect("/signup", {
        error: "That signup package is no longer active. Please choose another option.",
        displayName: normalizedDisplayName,
        firstName,
        lastName,
        phone,
        email,
        packageId,
        redirectTo,
      });
    }

    const signup = await beginPublicOtpSignup({
      displayName: normalizedDisplayName,
      phone: normalizedPhone,
      email,
      packageId,
      allowPackageChange: confirmPackageChange,
      deferOtpUntilWhatsAppCommand: true,
    });

    if (!signup.ok) {
      if ("conflict" in signup && signup.conflict) {
        return createPublicRedirect("/signup", {
          message:
            signup.conflict.kind === "same-package"
              ? `${signup.conflict.existingPackageName} is already active on this WhatsApp number. Use login OTP or choose a different package.`
              : `${signup.conflict.existingPackageName} is already active on this WhatsApp number. Confirm the package change to ${signup.conflict.requestedPackageName} before we send OTP.`,
          displayName: normalizedDisplayName,
          firstName,
          lastName,
          phone,
          email,
          packageId,
          redirectTo,
          packageConflictKind: signup.conflict.kind,
          conflictExistingPackageId: signup.conflict.existingPackageId,
          conflictExistingPackageName: signup.conflict.existingPackageName,
          conflictExistingPackageAudience: signup.conflict.existingPackageAudience ?? "",
          conflictRequestedPackageId: signup.conflict.requestedPackageId,
          conflictRequestedPackageName: signup.conflict.requestedPackageName,
          conflictRequestedPackageAudience: signup.conflict.requestedPackageAudience,
        });
      }

      return createPublicRedirect("/signup", {
        error: signup.error,
        displayName: normalizedDisplayName,
        firstName,
        lastName,
        phone,
        email,
        packageId,
        redirectTo,
      });
    }

    const resolvedRedirectTo = redirectTo.trim()
      ? getSafeRedirectPath(redirectTo, signup.user.role)
      : getDashboardPathForIdentity({
          role: signup.user.role,
          packageAudience: signup.user.packageAudience,
          workspaceMode: signup.user.workspaceMode,
        });

    const intent = await createPublicAuthIntent({
      flow: "SIGNUP",
      phone: normalizedPhone,
      displayName: normalizedDisplayName,
      email,
      packageId,
      salesReferralCode,
      redirectTo: resolvedRedirectTo,
      userId: signup.user.id,
    });

    if (salesReferralCode) {
      await trackSalesReferralEvent({
        code: salesReferralCode,
        eventType: "SIGNUP_STARTED",
        path: "/signup",
        packageId,
        userId: signup.user.id,
        eventKey: `signup-started:${intent.id}`,
        metadata: { intentId: intent.id, phone: normalizedPhone },
      }).catch((trackingError) => {
        console.error("[sales] Referral signup tracking failed", {
          intentId: intent.id,
          error: trackingError instanceof Error ? trackingError.message : "Unknown referral tracking error",
        });
      });
    }

    if ("requiresWhatsAppCommand" in signup && signup.requiresWhatsAppCommand) {
      const channel = await getPublicAuthOtpChannelInfo();
      return createPublicRedirect("/verify-otp", {
        intentId: intent.id,
        redirectTo: intent.redirectTo,
        identifier: intent.phone,
        otpFallback: "whatsapp-command",
        message: channel.isConfigured
          ? `Send ${getPublicAuthOtpCommand()} to ${channel.label} from this same number. The chatbot will reply with a fresh OTP.`
          : "WhatsApp OTP is temporarily unavailable. Ask support to restore the official OTP line.",
      });
    }

    if (signup.deliveryMode !== "preconfigured-code") {
      return createPublicRedirect("/verify-otp", {
        intentId: intent.id,
        redirectTo: intent.redirectTo,
        identifier: intent.phone,
        error: "We could not create the protected agency-code challenge right now.",
      });
    }

    await markPublicAuthIntentOtpIssued({
      intentId: intent.id,
      challengeId: signup.challengeId,
      userId: signup.user.id,
    });

    return createPublicRedirect("/verify-otp", {
      challengeId: signup.challengeId,
      intentId: intent.id,
      redirectTo: intent.redirectTo,
      identifier: intent.phone,
      otpMode: "preconfigured-code",
      message: "Enter the permanent code configured for this agency account.",
      otpHint: signup.testCode ?? undefined,
    });
  } catch (error) {
    console.error("Public signup failed", error);
    const message = sanitizePublicAuthError(error, "We could not create your account right now. Please try again in a moment.");
    return createPublicRedirect("/signup", {
      error: message,
      displayName: initialDisplayNameValidation.ok ? initialDisplayNameValidation.value : displayName,
      firstName,
      lastName,
      phone,
      email,
      packageId,
      redirectTo,
    });
  }
}
