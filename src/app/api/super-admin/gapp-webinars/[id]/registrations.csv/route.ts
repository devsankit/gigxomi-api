import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { exportGappRegistrationsCsv } from "@/lib/gigxomi/gapp-webinar-store";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const csv = await exportGappRegistrationsCsv(id);
  return new NextResponse(csv, {
    headers: {
      "Content-Disposition": `attachment; filename="gapp-registrations-${id}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
