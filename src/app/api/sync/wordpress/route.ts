import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { fetchWordPressServices } from "@/lib/gigxomi/wordpress";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const services = await fetchWordPressServices();

  return NextResponse.json({
    source: "wordpress",
    mode: "read-only-preview",
    syncedAt: new Date().toISOString(),
    count: services.count,
    preview: services.items.slice(0, 5).map((service) => ({
      wordpressServiceId: service.service_id,
      title: service.service_title,
      category: service.category,
      price: service.price,
      deliveryTime: service.delivery_time,
      editorUsername: service.freelancer.username,
    })),
  });
}
