import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  getMobilePushStoreDiagnostics,
  listMobilePushTokens,
  sendMobilePushNotifications,
  type MobilePushTokenRecord,
} from "@/lib/mobile-push-store";

type BroadcastAudience = "freelancer" | "editor" | "both";
type BroadcastPlatform = "all" | "mobile" | "web";

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAudience(value: unknown): BroadcastAudience {
  return value === "freelancer" || value === "editor" || value === "both" ? value : "both";
}

function normalizePlatform(value: unknown): BroadcastPlatform {
  return value === "web" || value === "mobile" || value === "all" ? value : "all";
}

function matchesAudience(record: MobilePushTokenRecord, audience: BroadcastAudience) {
  const role = String(record.role ?? "").trim().toUpperCase();
  if (audience === "both") {
    return role === "FREELANCER" || role === "EDITOR";
  }
  if (audience === "freelancer") {
    return role === "FREELANCER";
  }
  return role === "EDITOR";
}

function matchesPlatform(record: MobilePushTokenRecord, platform: BroadcastPlatform) {
  if (platform === "all") return true;
  if (platform === "web") return record.platform === "web";
  return record.platform === "android" || record.platform === "ios";
}

function summarizeTokens(records: MobilePushTokenRecord[]) {
  return {
    active: records.length,
    android: records.filter((record) => record.platform === "android").length,
    ios: records.filter((record) => record.platform === "ios").length,
    web: records.filter((record) => record.platform === "web").length,
    freelancer: records.filter((record) => String(record.role ?? "").toUpperCase() === "FREELANCER").length,
    editor: records.filter((record) => String(record.role ?? "").toUpperCase() === "EDITOR").length,
  };
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const [tokens, diagnostics] = await Promise.all([listMobilePushTokens({ activeOnly: true }), getMobilePushStoreDiagnostics()]);
  return NextResponse.json({
    ok: true,
    diagnostics,
    stats: summarizeTokens(tokens),
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => null)) as {
    audience?: unknown;
    body?: unknown;
    deepLinkUrl?: unknown;
    platform?: unknown;
    title?: unknown;
  } | null;
  const title = readString(body?.title) || "Gigxomi update";
  const messageBody = readString(body?.body);
  const deepLinkUrl = readString(body?.deepLinkUrl) || "/notifications";
  const audience = normalizeAudience(body?.audience);
  const platform = normalizePlatform(body?.platform);

  if (!messageBody) {
    return NextResponse.json({ ok: false, error: "Notification message is required." }, { status: 400 });
  }

  const tokens = (await listMobilePushTokens({ activeOnly: true })).filter(
    (record) => matchesAudience(record, audience) && matchesPlatform(record, platform),
  );
  if (!tokens.length) {
    const diagnostics = await getMobilePushStoreDiagnostics();
    return NextResponse.json({
      ok: false,
      error: "No active push tokens matched this audience and platform.",
      diagnostics,
      stats: summarizeTokens([]),
    }, { status: 404 });
  }

  const result = await sendMobilePushNotifications(tokens, {
    title,
    body: messageBody,
    data: {
      type: "marketing",
      deepLinkUrl,
      notificationChannelId: "gigxomi-status-updates",
      sentBy: authorization.session.userId,
    },
  });

  return NextResponse.json({
    ok: result.sent > 0,
    audience,
    platform,
    matched: tokens.length,
    result,
  });
}
