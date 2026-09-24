import { NextResponse } from "next/server";

import { consumeOtpChallenge } from "@/lib/auth/store";
import { createConnectedMobileAuthPayload } from "@/lib/connected-platform/mobile-auth";
import { listActiveRegistrationPackages } from "@/lib/gigxomi/public-growth-store";
import { prisma } from "@/lib/prisma";
import type { ManagedAuthUser } from "@/lib/auth/types";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const intentId = text(body?.intentId);
  const code = text(body?.code);
  const intent = intentId ? await prisma.connectedSignupIntent.findUnique({ where: { id: intentId } }) : null;
  if (!intent || intent.status !== "OTP_ISSUED" || intent.expiresAt <= new Date()) {
    return NextResponse.json({ ok: false, error: "Registration expired. Start again." }, { status: 400 });
  }
  if (!code) return NextResponse.json({ ok: false, error: "Enter the OTP code." }, { status: 400 });
  const result = await consumeOtpChallenge(intent.challengeId, code);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  const verifiedAt = new Date();
  const verifiedUserId = result.user.id;
  const sourceState = await prisma.connectedOnboardingState.findUnique({ where: { userId: intent.userId } });
  await prisma.$transaction(async (tx) => {
    await tx.connectedSignupIntent.update({
      where: { id: intent.id },
      data: { userId: verifiedUserId, status: "VERIFIED", verifiedAt },
    });
    await tx.connectedOnboardingState.upsert({
      where: { userId: verifiedUserId },
      create: {
        userId: verifiedUserId,
        audience: intent.audience,
        stage: "PACKAGE",
        otpVerifiedAt: verifiedAt,
        payload: sourceState?.payload ?? { provisionalPackageId: intent.provisionalPackageId },
      },
      update: { audience: intent.audience, stage: "PACKAGE", otpVerifiedAt: verifiedAt },
    });
    if (intent.userId !== verifiedUserId) {
      await tx.connectedOnboardingState.deleteMany({ where: { userId: intent.userId } });
    }
  });
  if (intent.audience === "FREELANCER") {
    try {
      const { autoQualifyLeadByCustomerPhone } = await import("@/lib/gigxomi/auto-lead-qualifier");
      await autoQualifyLeadByCustomerPhone({
        phone: result.user.phone || intent.phone || "",
        targetStatus: "app-installed",
        reason: "Editor downloaded mobile app and verified OTP",
        userId: result.user.id,
        email: result.user.email,
      });
    } catch (err) {
      console.error("[mobile-verify] Auto qualify error:", err);
    }
  }
  const packages = (await listActiveRegistrationPackages())
    .filter((pkg) => pkg.audience === intent.audience && pkg.isActive && pkg.allowRegistration !== false)
    .map((pkg) => ({
      ...pkg,
      commissionOverridePercent: intent.audience === "FREELANCER" ? 0 : pkg.commissionOverridePercent,
      zeroCommission: intent.audience === "FREELANCER",
    }));
  return NextResponse.json({ ok: true, nextAction: "package", packages, ...(await createConnectedMobileAuthPayload(result.user)) });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const intentId = text(searchParams.get("intentId"));
  const phone = text(searchParams.get("phone"));

  let intent = intentId ? await prisma.connectedSignupIntent.findUnique({ where: { id: intentId } }) : null;
  if (!intent && phone) {
    intent = await prisma.connectedSignupIntent.findFirst({
      where: { phone, status: "VERIFIED" },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (intent && intent.status === "VERIFIED") {
    const user = await prisma.appAuthUser.findUnique({ where: { id: intent.userId } });
    if (user) {
      const packages = (await listActiveRegistrationPackages())
        .filter((pkg) => pkg.audience === intent.audience && pkg.isActive && pkg.allowRegistration !== false)
        .map((pkg) => ({
          ...pkg,
          commissionOverridePercent: intent.audience === "FREELANCER" ? 0 : pkg.commissionOverridePercent,
          zeroCommission: intent.audience === "FREELANCER",
        }));
      return NextResponse.json({
        ok: true,
        verified: true,
        nextAction: "package",
        packages,
        ...(await createConnectedMobileAuthPayload(user as unknown as ManagedAuthUser)),
      });
    }
  }

  return NextResponse.json({ ok: true, verified: false });
}
