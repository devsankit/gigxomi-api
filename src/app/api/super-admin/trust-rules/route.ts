import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";

const KEYS = new Set(["ASSESSMENT", "PROFILE", "PORTFOLIO", "IDENTITY", "RELIABILITY", "ON_TIME", "RESPONSE", "UPDATES", "RATING"]);

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  return NextResponse.json({ ok: true, rules: await prisma.appTrustScoreRule.findMany({ orderBy: { key: "asc" } }) });
}
export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const key = typeof body?.key === "string" ? body.key.toUpperCase() : "";
  const weight = Math.max(0, Math.min(100, Math.round(Number(body?.weight ?? 0))));
  if (!KEYS.has(key)) return NextResponse.json({ ok: false, error: "Trust score component is invalid." }, { status: 400 });
  const existing = await prisma.appTrustScoreRule.findUnique({ where: { key } });
  const rule = await prisma.appTrustScoreRule.upsert({
    where: { key },
    create: { key, label: typeof body?.label === "string" ? body.label.trim() || key : key, weight, isActive: body?.isActive !== false, description: typeof body?.description === "string" ? body.description.trim() || null : null, updatedById: authorization.session.userId },
    update: { label: typeof body?.label === "string" ? body.label.trim() || existing?.label || key : existing?.label || key, weight, isActive: body?.isActive !== false, description: typeof body?.description === "string" ? body.description.trim() || null : existing?.description, updatedById: authorization.session.userId },
  });
  return NextResponse.json({ ok: true, rule });
}
