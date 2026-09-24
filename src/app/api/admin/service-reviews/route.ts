import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listServiceReviews, type ServiceReviewFilter } from "@/lib/gigxomi/service-review-service";

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { searchParams } = new URL(request.url);
  const filter = (searchParams.get("filter")?.toUpperCase() || "PENDING") as ServiceReviewFilter;
  const services = await listServiceReviews(filter);

  return NextResponse.json({
    ok: true,
    services,
    total: services.length,
  });
}