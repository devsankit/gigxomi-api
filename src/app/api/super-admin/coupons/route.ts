import { NextResponse } from "next/server";
import type { CouponDiscountDuration, CouponDiscountType } from "@prisma/client";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";

function date(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const campaigns = await prisma.couponCampaign.findMany({
    include: { codes: { include: { agent: { select: { agentCode: true, user: { select: { displayName: true } } } }, _count: { select: { redemptions: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ ok: true, campaigns });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const discountType: CouponDiscountType | null = body?.discountType === "FIXED" ? "FIXED" : body?.discountType === "PERCENTAGE" ? "PERCENTAGE" : null;
  const discountValue = Number(body?.discountValue ?? 0);
  const discountDuration: CouponDiscountDuration = body?.discountDuration === "RECURRING" ? "RECURRING" : "FIRST_CYCLE";
  const eligiblePackageIds = Array.isArray(body?.eligiblePackageIds) ? body.eligiblePackageIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  if (!name || !discountType || !Number.isFinite(discountValue) || discountValue <= 0 || (discountType === "PERCENTAGE" && discountValue > 100)) {
    return NextResponse.json({ ok: false, error: "Enter a campaign name and a valid discount." }, { status: 400 });
  }
  const data = {
    name,
    discountType,
    discountValue,
    discountDuration,
    eligiblePackageIds,
    maxRedemptions: body?.maxRedemptions == null ? null : Math.max(1, Math.round(Number(body.maxRedemptions))),
    perUserLimit: Math.max(1, Math.round(Number(body?.perUserLimit ?? 1))),
    startsAt: date(body?.startsAt),
    expiresAt: date(body?.expiresAt),
    isActive: body?.isActive === true,
    createdById: authorization.session.userId,
  };
  try {
    const campaign = typeof body?.id === "string" && body.id
      ? await prisma.couponCampaign.update({ where: { id: body.id }, data })
      : await prisma.couponCampaign.create({ data });
    return NextResponse.json({ ok: true, campaign });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save coupon campaign." }, { status: 400 });
  }
}
