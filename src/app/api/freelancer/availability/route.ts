import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { setEditorProjectAvailabilityFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { prisma } from "@/lib/prisma";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export async function GET() {
  const authorization = await requireSessionRole(["FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const workspace = await prisma.appFreelancerWorkspace.findUnique({ where: { userId: authorization.session.userId }, select: { profile: true } });
  const profile = record(workspace?.profile);
  const onlineStatus = profile.presenceMode === "OFFLINE" ? "offline" : "online";
  return NextResponse.json({
    ok: true,
    availability: {
      onlineStatus,
      acceptingProjects: typeof profile.acceptingProjects === "boolean" ? profile.acceptingProjects : onlineStatus === "online",
      updatedAt: typeof profile.presenceUpdatedAt === "string" ? profile.presenceUpdatedAt : null,
    },
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json().catch(() => ({}));
  const onlineStatus = body?.onlineStatus === "offline" ? "offline" : "online";
  const acceptingProjects = typeof body?.acceptingProjects === "boolean" ? body.acceptingProjects : onlineStatus === "online";
  const updatedAt = new Date().toISOString();
  const current = await prisma.appFreelancerWorkspace.findUnique({ where: { userId: authorization.session.userId }, select: { profile: true } });
  const profile = { ...record(current?.profile), presenceMode: onlineStatus.toUpperCase(), acceptingProjects, presenceUpdatedAt: updatedAt };
  const [, availability] = await Promise.all([
    prisma.appFreelancerWorkspace.upsert({
      where: { userId: authorization.session.userId },
      create: { userId: authorization.session.userId, profile, verification: {}, paymentDetails: {}, payoutRequests: [] },
      update: { profile },
    }),
    setEditorProjectAvailabilityFromFile(authorization.session.userId, { onlineStatus, acceptingProjects }),
  ]);

  return NextResponse.json({ ok: true, availability: { ...availability, onlineStatus, acceptingProjects, updatedAt } });
}
