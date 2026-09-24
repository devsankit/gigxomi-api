import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { disableMobilePushToken, upsertMobilePushToken } from "@/lib/mobile-push-store";

type PushTokenBody = {
  provider?: unknown;
  token?: unknown;
  platform?: unknown;
  projectOfferChannelId?: unknown;
  supportsProjectOfferActions?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!auth.ok) {
    return auth.response;
  }

  let body: PushTokenBody;
  try {
    body = (await request.json()) as PushTokenBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const platform = body.platform === "ios" || body.platform === "web" ? body.platform : "android";
  const projectOfferChannelId = typeof body.projectOfferChannelId === "string" ? body.projectOfferChannelId.trim() : null;
  const supportsProjectOfferActions = body.supportsProjectOfferActions === true;

  if (!token) {
    return NextResponse.json({ ok: false, error: "Push token is required." }, { status: 400 });
  }

  const stored = await upsertMobilePushToken({
    userId: auth.session.userId,
    token,
    platform,
    provider: "fcm",
    role: auth.session.role,
    tenantId: auth.session.tenantId,
    projectOfferChannelId,
    supportsProjectOfferActions,
  });

  return NextResponse.json({ ok: true, token: stored.token, status: "registered" });
}

export async function DELETE(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!auth.ok) {
    return auth.response;
  }

  let body: PushTokenBody;
  try {
    body = (await request.json()) as PushTokenBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token) {
    await disableMobilePushToken({ userId: auth.session.userId, token });
  }

  return NextResponse.json({ ok: true, status: "disabled" });
}
