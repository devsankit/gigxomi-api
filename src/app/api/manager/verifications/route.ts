import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) return authorization.response;

  const tenantId = resolveSessionTenantId(authorization.session) || authorization.session.tenantId?.trim();

  try {
    const [teamRequests, pendingOnboarding] = await Promise.all([
      prisma.appTeamRequest.findMany({
        where: tenantId ? { tenantId } : {},
        orderBy: { createdAt: "desc" },
        take: 20,
      }).catch(() => []),
      prisma.connectedOnboardingState.findMany({
        where: {
          stage: { not: "COMPLETE" },
        },
        include: {
          user: {
            select: { displayName: true, email: true, phone: true },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }).catch(() => []),
    ]);

    const items = [
      ...teamRequests.map((req) => ({
        id: req.id,
        title: req.freelancerName || "Team Specialist",
        status: req.status === "PENDING" ? "Awaiting acceptance" : req.status === "ACCEPTED" ? "Verified" : req.status,
        note: req.message || `Invited to agency team as ${req.roleType}.`,
        createdAt: req.createdAt.toISOString(),
      })),
      ...pendingOnboarding.map((ob) => {
        const payload = ob.payload && typeof ob.payload === "object" ? (ob.payload as Record<string, unknown>) : {};
        const name = String(ob.user?.displayName || payload.displayName || payload.fullName || ob.userId);
        return {
          id: ob.userId,
          title: name,
          status: "Pending Profile / KYC",
          note: `Onboarding stage: ${ob.stage}. Identity verification in progress.`,
          createdAt: ob.updatedAt.toISOString(),
        };
      }),
    ];

    return NextResponse.json({
      ok: true,
      items,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load verification queue";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
