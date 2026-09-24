import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { saveGappWebinarThumbnail } from "@/lib/gigxomi/gapp-webinar-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const formData = await request.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Upload a webinar thumbnail." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "Thumbnail must be an image." }, { status: 400 });
  }

  const webinar = await saveGappWebinarThumbnail({
    fileBuffer: await file.arrayBuffer(),
    fileName: file.name,
    mimeType: file.type,
    webinarId: id,
  });

  return NextResponse.json({ ok: true, webinar });
}
