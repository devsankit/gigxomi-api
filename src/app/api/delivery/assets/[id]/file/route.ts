import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getDeliveryAssetLatestVersion } from "@/lib/gigxomi/delivery-portfolio-store";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const payload = await getDeliveryAssetLatestVersion(id);

  if (!payload) {
    return NextResponse.json({ ok: false, error: "Delivery file not found." }, { status: 404 });
  }

  if (authorization.session.role === "FREELANCER" && payload.asset.assignedFreelancerName !== authorization.session.displayName) {
    return NextResponse.json({ ok: false, error: "You do not have access to this delivery file." }, { status: 403 });
  }

  const fileBuffer = await readFile(payload.version.storagePath);
  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": payload.version.mimeType || "application/octet-stream",
      "Content-Length": String(fileBuffer.byteLength),
      "Content-Disposition": `inline; filename="${payload.version.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
