import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const identity = await prisma.appFreelancerIdentity.findUnique({
    where: { userId: authorization.session.userId },
    select: { status: true, documentType: true, issuer: true, verifiedAt: true, consentedAt: true },
  });
  return NextResponse.json({
    ok: true,
    verification: identity ?? { status: "NOT_STARTED", documentType: null, issuer: null, verifiedAt: null, consentedAt: null },
  });
}

export async function POST() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  return NextResponse.json({ ok: false, error: "Manual ID collection is disabled. Use the DigiLocker verification flow." }, { status: 410 });
}
