import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getDeliveryAssetById } from "@/lib/gigxomi/delivery-portfolio-store";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const asset = await getDeliveryAssetById(id);

  if (!asset) {
    return NextResponse.json({ ok: false, error: "Delivery asset not found." }, { status: 404 });
  }

  if (authorization.session.role === "FREELANCER" && asset.assignedFreelancerName !== authorization.session.displayName) {
    return NextResponse.json({ ok: false, error: "You do not have access to this delivery asset." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    asset,
  });
}
