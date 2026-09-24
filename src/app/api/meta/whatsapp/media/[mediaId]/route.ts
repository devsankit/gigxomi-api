import { NextRequest, NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getWhatsAppConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ mediaId: string }> },
) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;

  const { mediaId } = await context.params;
  const normalizedMediaId = decodeURIComponent(String(mediaId ?? "").trim());
  const requestedTenantId = request.nextUrl.searchParams.get("tenantId")?.trim() || "";
  const tenantId = authorization.session.role === "SUPER_ADMIN"
    ? requestedTenantId || authorization.session.tenantId || "tenant-gigxomi"
    : authorization.session.tenantId || "tenant-gigxomi";
  const fallbackMimeType = request.nextUrl.searchParams.get("mimeType")?.trim() || "application/octet-stream";
  const fileName = (request.nextUrl.searchParams.get("fileName")?.trim() || "whatsapp-media").replace(/["\r\n]/g, "");

  if (!normalizedMediaId) {
    return NextResponse.json({ ok: false, error: "Media ID is required." }, { status: 400 });
  }

  const connection = await getWhatsAppConnectionStateFromFile(tenantId);
  if (!connection?.accessToken?.trim()) {
    return NextResponse.json({ ok: false, error: "WhatsApp media fetch is not configured for this tenant." }, { status: 503 });
  }

  const metadataResponse = await fetch(`https://graph.facebook.com/${connection.graphApiVersion}/${encodeURIComponent(normalizedMediaId)}`, {
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
    },
    cache: "no-store",
  });

  if (!metadataResponse.ok) {
    const details = await metadataResponse.text().catch(() => "");
    return NextResponse.json(
      { ok: false, error: details || "Unable to resolve the WhatsApp media file." },
      { status: metadataResponse.status || 502 },
    );
  }

  const metadata = (await metadataResponse.json().catch(() => null)) as
    | {
        url?: string;
        mime_type?: string;
      }
    | null;
  const downloadUrl = String(metadata?.url ?? "").trim();
  const mimeType = String(metadata?.mime_type ?? fallbackMimeType).trim() || fallbackMimeType;

  if (!downloadUrl) {
    return NextResponse.json({ ok: false, error: "WhatsApp media URL was missing from Meta." }, { status: 502 });
  }

  const mediaResponse = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
    },
    cache: "no-store",
  });

  if (!mediaResponse.ok || !mediaResponse.body) {
    const details = await mediaResponse.text().catch(() => "");
    return NextResponse.json(
      { ok: false, error: details || "Unable to download the WhatsApp media file." },
      { status: mediaResponse.status || 502 },
    );
  }

  return new NextResponse(mediaResponse.body, {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename=\"${fileName.replace(/"/g, "")}\"`,
      "Content-Type": mediaResponse.headers.get("content-type")?.trim() || mimeType,
    },
  });
}
