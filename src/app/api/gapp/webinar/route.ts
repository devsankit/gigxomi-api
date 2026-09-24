import { NextResponse } from "next/server";

import { getActiveGappWebinar, getPublicGappLinks } from "@/lib/gigxomi/gapp-webinar-store";

export async function GET() {
  const webinar = await getActiveGappWebinar();
  return NextResponse.json({
    ok: true,
    links: {
      supportPhone: getPublicGappLinks().supportPhone,
    },
    webinar,
  });
}
