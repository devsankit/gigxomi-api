import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { calculateFreelancerTrustScore, ensureFreelancerOnboarding } from "@/lib/gigxomi/freelancer-onboarding-service";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const now = new Date();
  await prisma.appFreelancerIdentity.upsert({
    where: { userId: authorization.session.userId },
    create: { userId: authorization.session.userId, status: "SKIPPED", skippedAt: now },
    update: {
      status: "SKIPPED",
      skippedAt: now,
      verifiedAt: null,
      consentedAt: null,
      oauthStateHash: null,
      oauthNonceHash: null,
      oauthCodeVerifier: null,
      oauthExpiresAt: null,
      lastError: null,
    },
  });
  await prisma.appFreelancerOnboarding.update({ where: { userId: authorization.session.userId }, data: { identityChoiceAt: now } }).catch(() => undefined);
  const state = await ensureFreelancerOnboarding(authorization.session);
  await calculateFreelancerTrustScore(authorization.session.userId);
  return NextResponse.json({ ok: true, completed: state.completed });
}
