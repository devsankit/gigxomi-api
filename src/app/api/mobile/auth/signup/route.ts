import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/auth/normalize";
import { createPublicAuthIntent, markPublicAuthIntentOtpIssued } from "@/lib/auth/public-auth-intent-store";
import { validatePublicDisplayName, validatePublicNamePart } from "@/lib/auth/public-display-name";
import { beginPublicOtpSignup } from "@/lib/auth/store";
import { buildPublicAuthWhatsAppHref, getPublicAuthOtpChannelInfo, getPublicAuthOtpCommand } from "@/lib/auth/public-whatsapp";
import { findLaunchRegistrationPackage } from "@/lib/gigxomi/public-growth-store";

type MobileSignupBody = {
  firstName?: unknown;
  lastName?: unknown;
  displayName?: unknown;
  email?: unknown;
  phone?: unknown;
  packageId?: unknown;
  confirmPackageChange?: unknown;
};

function readBodyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  let body: MobileSignupBody;

  try {
    body = (await request.json()) as MobileSignupBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Send a valid JSON signup body." }, { status: 400 });
  }

  const firstName = readBodyString(body.firstName);
  const lastName = readBodyString(body.lastName);
  const legacyDisplayName = readBodyString(body.displayName);
  const displayName = firstName || lastName ? `${firstName} ${lastName}`.trim() : legacyDisplayName;
  const email = readBodyString(body.email);
  const phone = readBodyString(body.phone);
  const packageId = readBodyString(body.packageId);
  const confirmPackageChange = body.confirmPackageChange === true;

  if (!displayName || !phone || !packageId) {
    return NextResponse.json(
      { ok: false, error: "First name, last name, WhatsApp number, and package selection are required." },
      { status: 400 },
    );
  }

  if (firstName || lastName) {
    const firstNameValidation = validatePublicNamePart(firstName, "first name");
    const lastNameValidation = validatePublicNamePart(lastName, "last name");
    if (!firstNameValidation.ok || !lastNameValidation.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: !firstNameValidation.ok
            ? firstNameValidation.error
            : !lastNameValidation.ok
              ? lastNameValidation.error
              : "Enter your first and last name.",
        },
        { status: 400 },
      );
    }
  }

  const displayNameValidation = validatePublicDisplayName(displayName);
  if (!displayNameValidation.ok) {
    return NextResponse.json({ ok: false, error: displayNameValidation.error }, { status: 400 });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return NextResponse.json({ ok: false, error: "Enter a valid WhatsApp number to continue." }, { status: 400 });
  }

  const selectedPackage = await findLaunchRegistrationPackage(packageId);
  if (!selectedPackage || !selectedPackage.isActive || selectedPackage.allowRegistration === false) {
    return NextResponse.json({ ok: false, error: "That signup package is no longer active. Please choose another option." }, { status: 404 });
  }

  const signup = await beginPublicOtpSignup({
    displayName: displayNameValidation.value,
    phone: normalizedPhone,
    email,
    packageId,
    allowPackageChange: confirmPackageChange,
    deferOtpUntilWhatsAppCommand: true,
  });

  if (!signup.ok) {
    if ("conflict" in signup && signup.conflict) {
      return NextResponse.json(
        {
          ok: false,
          error:
            signup.conflict.kind === "same-package"
              ? `${signup.conflict.existingPackageName} is already active on this WhatsApp number. Use login OTP or choose a different package.`
              : `${signup.conflict.existingPackageName} is already active on this WhatsApp number. Confirm package change before OTP.`,
          conflict: signup.conflict,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: false, error: signup.error }, { status: 400 });
  }

  const intent = await createPublicAuthIntent({
    flow: "SIGNUP",
    phone: normalizedPhone,
    displayName: displayNameValidation.value,
    email,
    packageId,
    redirectTo: null,
    userId: signup.user.id,
  });

  if ("requiresWhatsAppCommand" in signup && signup.requiresWhatsAppCommand) {
    const [otpChannel, whatsappHref] = await Promise.all([getPublicAuthOtpChannelInfo(), buildPublicAuthWhatsAppHref()]);
    return NextResponse.json({
      ok: true,
      challengeId: null,
      intentId: intent.id,
      phone: normalizedPhone,
      deliveryMode: "whatsapp-command",
      requiresWhatsAppCommand: true,
      otpFallback: "whatsapp-command",
      otpCommand: getPublicAuthOtpCommand(),
      otpChannelLabel: otpChannel.label,
      whatsappHref,
      message: otpChannel.isConfigured
        ? `Open WhatsApp and send ${getPublicAuthOtpCommand()} to ${otpChannel.label} from this same number.`
        : "WhatsApp OTP is temporarily unavailable. Ask support to restore the official OTP line.",
    });
  }

  if (signup.deliveryMode !== "preconfigured-code") {
    return NextResponse.json({ ok: false, error: "We could not create the protected agency-code challenge." }, { status: 503 });
  }
  await markPublicAuthIntentOtpIssued({
    intentId: intent.id,
    challengeId: signup.challengeId,
    userId: signup.user.id,
  });

  return NextResponse.json({
    ok: true,
    challengeId: signup.challengeId,
    intentId: intent.id,
    phone: normalizedPhone,
    deliveryMode: signup.deliveryMode,
    expiresAt: signup.expiresAt,
    testCode: signup.testCode,
    message: "Enter the permanent code configured for this agency account.",
  });
}
