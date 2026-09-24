import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { refreshDeliveryReviewLink } from "@/lib/gigxomi/delivery-portfolio-store";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const asset = await refreshDeliveryReviewLink(id);

  if (!asset) {
    return NextResponse.json({ ok: false, error: "Delivery asset not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    asset,
  });
}
