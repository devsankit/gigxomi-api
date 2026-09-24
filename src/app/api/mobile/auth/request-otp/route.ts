import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/auth/normalize";
import { getPostProductionFixedOtpHash } from "@/lib/auth/post-production-agency-config";
import { createPublicAuthIntent, markPublicAuthIntentOtpIssued } from "@/lib/auth/public-auth-intent-store";
import { getDashboardPathForIdentity } from "@/lib/auth/session";
import { createOtpChallenge, findUserByIdentifier, getOtpChallengeMode } from "@/lib/auth/store";
import { buildPublicAuthWhatsAppHref, getPublicAuthOtpChannelInfo, getPublicAuthOtpCommand } from "@/lib/auth/public-whatsapp";

type MobileOtpRequestBody = {
  identifier?: unknown;
  phone?: unknown;
  loginScope?: unknown;
  role?: unknown;
};

function readBodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  let body: MobileOtpRequestBody;

  try {
    body = (await request.json()) as MobileOtpRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Send a valid JSON OTP request body." }, { status: 400 });
  }

  const rawIdentifier = (readBodyString(body.phone) || readBodyString(body.identifier)).trim();
  const rawScope = (readBodyString(body.loginScope) || readBodyString(body.role)).trim().toLowerCase();
  const requireManager = rawScope === "manager";
  const normalizedPhone = normalizePhone(rawIdentifier);

  if (!normalizedPhone) {
    return NextResponse.json({ ok: false, error: "Enter a valid WhatsApp phone number." }, { status: 400 });
  }

  const user = await findUserByIdentifier(normalizedPhone);
  if (!user) {
    return NextResponse.json({ ok: false, error: "No account matches that WhatsApp number yet." }, { status: 404 });
  }
  if (requireManager && user.role !== "MANAGER") {
    return NextResponse.json({ ok: false, error: "This WhatsApp number is not linked to a manager account." }, { status: 403 });
  }

  const challengeMode = await getOtpChallengeMode(normalizedPhone);
  if (challengeMode === "preconfigured-code" && !getPostProductionFixedOtpHash()) {
    return NextResponse.json(
      { ok: false, error: "Protected agency sign-in is temporarily unavailable. Ask support to restore the agency access code." },
      { status: 503 },
    );
  }

  const intent = await createPublicAuthIntent({
    flow: "LOGIN",
    phone: normalizedPhone,
    redirectTo: getDashboardPathForIdentity({
      role: user.role,
      packageAudience: user.packageAudience,
      workspaceMode: user.workspaceMode,
    }),
    userId: user.id,
  });
  if (challengeMode !== "preconfigured-code") {
    const [otpChannel, whatsappHref] = await Promise.all([getPublicAuthOtpChannelInfo(), buildPublicAuthWhatsAppHref()]);
    return NextResponse.json({
      ok: true,
      challengeId: null,
      intentId: intent.id,
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

  let challenge: Awaited<ReturnType<typeof createOtpChallenge>>;
  try {
    challenge = await createOtpChallenge(normalizedPhone);
  } catch (error) {
    console.error("Protected agency OTP challenge creation failed.", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { ok: false, error: "Protected agency sign-in is temporarily unavailable. Ask support to restore the agency access code." },
      { status: 503 },
    );
  }
  if (!challenge || challenge.deliveryMode !== "preconfigured-code") {
    return NextResponse.json({ ok: false, error: "We could not create the protected agency-code challenge." }, { status: 503 });
  }
  await markPublicAuthIntentOtpIssued({
    intentId: intent.id,
    challengeId: challenge.challengeId,
    userId: challenge.user.id,
  });
  return NextResponse.json({
    ok: true,
    challengeId: challenge.challengeId,
    intentId: intent.id,
    deliveryMode: challenge.deliveryMode,
    expiresAt: challenge.expiresAt,
    testCode: challenge.testCode,
    message: "Enter the permanent code configured for this agency account.",
  });
}
