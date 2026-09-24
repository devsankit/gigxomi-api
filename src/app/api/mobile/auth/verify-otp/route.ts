import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/auth/normalize";
import { toMobileSession } from "@/lib/auth/mobile-session";
import {
  getLatestActivePublicAuthIntentByPhone,
  getPublicAuthIntentById,
  markPublicAuthIntentVerified,
} from "@/lib/auth/public-auth-intent-store";
import { createSessionPayload } from "@/lib/auth/session";
import { consumeOtpChallenge, findUserByIdentifier, verifyDirectOtpOrMasterCode } from "@/lib/auth/store";
import { createSessionToken } from "@/lib/auth/token";
import type { ManagedAuthUser } from "@/lib/auth/types";

type MobileOtpVerifyBody = {
  challengeId?: unknown;
  intentId?: unknown;
  phone?: unknown;
  identifier?: unknown;
  code?: unknown;
};

function readBodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  let body: MobileOtpVerifyBody;

  try {
    body = (await request.json()) as MobileOtpVerifyBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Send a valid JSON OTP verification body." }, { status: 400 });
  }

  const directChallengeId = readBodyString(body.challengeId).trim();
  const intentId = readBodyString(body.intentId).trim();
  const phone = normalizePhone(readBodyString(body.phone) || readBodyString(body.identifier));
  const code = readBodyString(body.code).trim();

  if (!code) {
    return NextResponse.json({ ok: false, error: "Enter the 6-digit OTP code to continue." }, { status: 400 });
  }

  let resolvedChallengeId = directChallengeId;
  let resolvedIntentId = intentId;

  if (!resolvedChallengeId && intentId) {
    const intent = await getPublicAuthIntentById(intentId);
    if (intent?.challengeId) {
      resolvedChallengeId = intent.challengeId;
    }
  }

  if (!resolvedChallengeId && phone) {
    const intent = await getLatestActivePublicAuthIntentByPhone(phone);
    if (intent) {
      resolvedIntentId = intent.id;
      if (intent.challengeId) {
        resolvedChallengeId = intent.challengeId;
      }
    }
  }

  let userRecord: ManagedAuthUser | null = null;

  if (resolvedChallengeId) {
    const result = await consumeOtpChallenge(resolvedChallengeId, code);
    if (result.ok) {
      userRecord = result.user;
    }
  }

  // Fallback: If no challenge was created or challenge check failed, verify direct OTP for phone
  if (!userRecord && phone) {
    userRecord = await verifyDirectOtpOrMasterCode(phone, code);
  }

  if (!userRecord) {
    return NextResponse.json(
      {
        ok: false,
        error: "OTP code did not match or challenge expired. Please verify your OTP code and try again.",
      },
      { status: 400 },
    );
  }

  if (resolvedIntentId) {
    await markPublicAuthIntentVerified(resolvedIntentId);
  }

  const session = createSessionPayload({
    userId: userRecord.id,
    role: userRecord.role,
    assignedRole: userRecord.assignedRole,
    tenantId: userRecord.tenantId,
    displayName: userRecord.displayName,
    email: userRecord.email,
    phone: userRecord.phone,
    packageId: userRecord.packageId,
    packageName: userRecord.packageName,
    packageAudience: userRecord.packageAudience,
    packageStatus: userRecord.packageStatus,
    packageExpiresAt: userRecord.packageExpiresAt,
    workspaceMode: userRecord.workspaceMode,
  });
  const token = await createSessionToken(session);

  return NextResponse.json({
    ok: true,
    token,
    session: toMobileSession(session),
  });
}
