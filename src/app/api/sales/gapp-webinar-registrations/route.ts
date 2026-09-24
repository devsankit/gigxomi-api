import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listGappRegistrationsForFollowUp } from "@/lib/gigxomi/gapp-webinar-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const data = await listGappRegistrationsForFollowUp(200);
  return NextResponse.json({
    ok: true,
    registrations: data.registrations.map((registration) => ({
      createdAt: registration.createdAt.toISOString(),
      currentMonthlyProjects: registration.currentMonthlyProjects,
      email: registration.email,
      fullName: registration.fullName,
      id: registration.id,
      participantType: registration.participantType,
      paymentStatus: registration.payments[0]?.status ?? "",
      status: registration.status,
      whatsappNumber: registration.whatsappNumber,
    })),
    webinar: {
      id: data.webinar.id,
      priceAmount: Number(data.webinar.priceAmount),
      priceMode: data.webinar.priceMode,
      scheduledAt: data.webinar.scheduledAt.toISOString(),
      title: data.webinar.title,
    },
  });
}
