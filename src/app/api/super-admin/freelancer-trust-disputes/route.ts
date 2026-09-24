import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { calculateFreelancerTrustScore } from "@/lib/gigxomi/freelancer-onboarding-service";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]); if (!auth.ok) return auth.response;
  const body = await request.json(); const id = String(body.disputeId ?? "").trim(); const action = String(body.action ?? "").trim().toUpperCase(); const note = String(body.note ?? "").trim();
  if (!id || !["UPHOLD", "RESTORE"].includes(action) || !note) return NextResponse.json({ ok: false, error: "Choose a resolution and add a note." }, { status: 400 });
  const dispute = await prisma.appFreelancerTrustDispute.findUnique({ where: { id } }); if (!dispute) return NextResponse.json({ ok: false, error: "Dispute was not found." }, { status: 404 });
  await prisma.$transaction([
    prisma.appFreelancerTrustDispute.update({ where: { id }, data: { status: action === "RESTORE" ? "RESTORED" : "UPHELD", resolutionNote: note, reviewedByUserId: auth.session.userId, reviewedAt: new Date() } }),
    prisma.appFreelancerTrustEvent.update({ where: { id: dispute.eventId }, data: { status: action === "RESTORE" ? "EXCLUDED" : "APPLIED" } }),
  ]);
  await calculateFreelancerTrustScore(dispute.userId);
  return NextResponse.json({ ok: true });
}
