import { NextResponse } from "next/server";
import type { ConnectedAudience, DripCampaignTrigger } from "@prisma/client";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";

const AUDIENCES = new Set<ConnectedAudience>(["CRM", "AGENCY", "FREELANCER"]);
const TRIGGERS = new Set<DripCampaignTrigger>(["PROFILE_INCOMPLETE", "REQUIRED_LEARNING_INCOMPLETE", "SLOW_REPLY", "MISSED_WORK", "TRUST_SCORE_BELOW"]);

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const campaigns = await prisma.appDripCampaign.findMany({ include: { _count: { select: { deliveries: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ ok: true, campaigns });
}
export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const trigger = typeof body?.trigger === "string" && TRIGGERS.has(body.trigger as DripCampaignTrigger) ? body.trigger as DripCampaignTrigger : null;
  const audiences = Array.isArray(body?.audiences) ? body.audiences.filter((item): item is ConnectedAudience => typeof item === "string" && AUDIENCES.has(item as ConnectedAudience)) : [];
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const titleTemplate = typeof body?.titleTemplate === "string" ? body.titleTemplate.trim() : "";
  const bodyTemplate = typeof body?.bodyTemplate === "string" ? body.bodyTemplate.trim() : "";
  if (!name || !trigger || !audiences.length || !titleTemplate || !bodyTemplate) return NextResponse.json({ ok: false, error: "Name, trigger, audience, title, and message are required." }, { status: 400 });
  const data = {
    name,
    trigger,
    audiences,
    delayMinutes: Math.max(0, Math.round(Number(body?.delayMinutes ?? 1440))),
    cooldownMinutes: Math.max(60, Math.round(Number(body?.cooldownMinutes ?? 1440))),
    maxSendsPerUser: Math.max(1, Math.round(Number(body?.maxSendsPerUser ?? 3))),
    localWindowStart: typeof body?.localWindowStart === "string" ? body.localWindowStart : "09:00",
    localWindowEnd: typeof body?.localWindowEnd === "string" ? body.localWindowEnd : "20:00",
    titleTemplate,
    bodyTemplate,
    destination: typeof body?.destination === "string" ? body.destination.trim() || null : null,
    threshold: body?.threshold == null ? null : Math.round(Number(body.threshold)),
    stopCondition: body?.stopCondition && typeof body.stopCondition === "object" ? body.stopCondition : {},
    isActive: body?.isActive === true,
    createdById: authorization.session.userId,
  };
  const campaign = typeof body?.id === "string" && body.id
    ? await prisma.appDripCampaign.update({ where: { id: body.id }, data })
    : await prisma.appDripCampaign.create({ data });
  return NextResponse.json({ ok: true, campaign });
}
