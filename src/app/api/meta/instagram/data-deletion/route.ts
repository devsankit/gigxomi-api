import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { updateInstagramConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { buildInstagramMetaSetupUrls } from "@/lib/meta/instagram-routes";
import { getInstagramAppSecret, parseMetaSignedRequest } from "@/lib/meta/signed-request";

async function readSignedRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { signed_request?: unknown } | null;
    return typeof body?.signed_request === "string" ? body.signed_request : "";
  }

  const form = await request.formData().catch(() => null);
  const signedRequest = form?.get("signed_request");
  return typeof signedRequest === "string" ? signedRequest : "";
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      endpoint: "Instagram data deletion callback is live.",
      callbackUrl: buildInstagramMetaSetupUrls().dataDeletionRequestUrl,
      method: "POST",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const signedRequest = await readSignedRequest(request);
  const parsed = parseMetaSignedRequest(signedRequest, getInstagramAppSecret());
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 403 });
  }

  const userId = String(parsed.payload.user_id ?? "").trim();
  const confirmationCode = `ig-delete-${randomUUID()}`;

  await updateInstagramConnectionStateFromFile("tenant-gigxomi", {
    accessToken: "",
    accountId: "",
    accountType: "",
    connectedAt: "",
    expiresAt: "",
    lastError: userId ? `Instagram data deletion requested for user ${userId}.` : "Instagram data deletion requested.",
    scopes: [],
    status: "Not connected",
    tokenType: "",
    username: "",
  });

  const base = buildInstagramMetaSetupUrls().dataDeletionRequestUrl;

  return NextResponse.json({
    url: `${base}/status?code=${encodeURIComponent(confirmationCode)}`,
    confirmation_code: confirmationCode,
  });
}
