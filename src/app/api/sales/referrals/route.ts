import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";
import { generateCouponCode } from "@/lib/connected-platform/coupons";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const [snapshot, campaigns] = await Promise.all([
    getSalesSnapshotForRole(authorization.session),
    prisma.couponCampaign.findMany({
      where: { isActive: true, OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const visibleAgentIds = new Set(snapshot.visibleAgents.map((agent) => agent.id));
  return NextResponse.json({ ok: true, referrals: snapshot.referrals.filter((referral) => visibleAgentIds.has(referral.agentId)), campaigns });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const campaignId = typeof body?.campaignId === "string" ? body.campaignId : "";
  const campaign = campaignId ? await prisma.couponCampaign.findUnique({ where: { id: campaignId } }) : null;
  if (!campaign || !campaign.isActive || (campaign.startsAt && campaign.startsAt > new Date()) || (campaign.expiresAt && campaign.expiresAt <= new Date())) {
    return NextResponse.json({ ok: false, error: "Coupon campaign is not active." }, { status: 400 });
  }
  const agent = authorization.session.role === "SALES_AGENT"
    ? await prisma.salesAgentProfile.findUnique({ where: { userId: authorization.session.userId } })
    : typeof body?.agentId === "string"
      ? await prisma.salesAgentProfile.findUnique({ where: { id: body.agentId } })
      : null;
  if (!agent) return NextResponse.json({ ok: false, error: "A sales agent is required." }, { status: 400 });

  const requestedPrefix = typeof body?.prefix === "string" ? body.prefix : agent.agentCode;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const code = await prisma.salesReferralCode.create({
        data: {
          agentId: agent.id,
          campaignId: campaign.id,
          code: generateCouponCode(requestedPrefix),
          label: campaign.name,
          discountType: campaign.discountType,
          discountValue: campaign.discountValue,
          discountDuration: campaign.discountDuration,
          eligiblePackageIds: campaign.eligiblePackageIds,
          maxRedemptions: campaign.maxRedemptions,
          perUserLimit: campaign.perUserLimit,
          startsAt: campaign.startsAt,
          expiresAt: campaign.expiresAt,
          isActive: true,
        },
      });
      return NextResponse.json({ ok: true, code });
    } catch (error) {
      if (attempt === 3) return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to generate coupon." }, { status: 400 });
    }
  }
  return NextResponse.json({ ok: false, error: "Unable to generate coupon." }, { status: 400 });
}
