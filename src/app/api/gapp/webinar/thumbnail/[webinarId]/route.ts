import { NextResponse } from "next/server";

import { readGappWebinarThumbnail } from "@/lib/gigxomi/gapp-webinar-store";

export async function GET(_: Request, context: { params: Promise<{ webinarId: string }> }) {
  const { webinarId } = await context.params;
  const thumbnail = await readGappWebinarThumbnail(decodeURIComponent(webinarId));
  if (!thumbnail) {
    return NextResponse.json({ ok: false, error: "Thumbnail not found." }, { status: 404 });
  }

  return new NextResponse(thumbnail.bytes, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "image/jpeg",
    },
  });
}
