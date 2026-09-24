import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";

const ACTIVE_VIEW_TTL_MS = 75_000;
const ALLOWED_VIEW_TYPES = new Set(["chat", "project", "team"]);

function payload(body: Record<string, unknown> | null) {
  return {
    viewType: typeof body?.viewType === "string" ? body.viewType.trim() : "",
    referenceId: typeof body?.referenceId === "string" ? body.referenceId.trim() : "",
  };
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const { viewType, referenceId } = payload(await request.json().catch(() => null));
  if (!ALLOWED_VIEW_TYPES.has(viewType) || !referenceId) return NextResponse.json({ ok: false, error: "Valid viewType and referenceId are required." }, { status: 400 });
  await prisma.mobileActiveView.upsert({
    where: { userId_viewType_referenceId: { userId: authorization.session.userId, viewType, referenceId } },
    create: { userId: authorization.session.userId, viewType, referenceId, expiresAt: new Date(Date.now() + ACTIVE_VIEW_TTL_MS) },
    update: { expiresAt: new Date(Date.now() + ACTIVE_VIEW_TTL_MS) },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const { viewType, referenceId } = payload(await request.json().catch(() => null));
  if (!ALLOWED_VIEW_TYPES.has(viewType) || !referenceId) return NextResponse.json({ ok: false, error: "Valid viewType and referenceId are required." }, { status: 400 });
  await prisma.mobileActiveView.deleteMany({ where: { userId: authorization.session.userId, viewType, referenceId } });
  return NextResponse.json({ ok: true });
}
