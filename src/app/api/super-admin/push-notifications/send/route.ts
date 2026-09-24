import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import {
  listMobilePushTokens,
  sendMobilePushNotifications,
  type MobilePushTokenRecord,
} from "@/lib/mobile-push-store";
import { prisma } from "@/lib/prisma";

type TargetMode = "user" | "audience";
type AudienceType = "all" | "agency" | "freelancer" | "editor" | "both";
type PlatformTarget = "all" | "mobile" | "web";

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function matchesAudience(record: MobilePushTokenRecord, audience: AudienceType) {
  if (audience === "all") return true;
  const role = String(record.role ?? "").trim().toUpperCase();
  if (audience === "both") return role === "FREELANCER" || role === "EDITOR" || role === "ADMIN" || role === "MANAGER";
  if (audience === "freelancer") return role === "FREELANCER";
  if (audience === "editor") return role === "EDITOR";
  if (audience === "agency") return role === "ADMIN" || role === "MANAGER" || role === "AGENCY";
  return true;
}

function matchesPlatform(record: MobilePushTokenRecord, platform: PlatformTarget) {
  if (platform === "all") return true;
  if (platform === "web") return record.platform === "web";
  return record.platform === "android" || record.platform === "ios";
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const targetMode = (readString(body?.targetMode) || "audience") as TargetMode;
  const targetUserId = readString(body?.targetUserId);
  const audience = (readString(body?.audience) || "both") as AudienceType;
  const platform = (readString(body?.platform) || "all") as PlatformTarget;
  const title = readString(body?.title) || "Gigxomi update";
  const message = readString(body?.message) || readString(body?.body);
  const deepLinkUrl = readString(body?.deepLinkUrl) || "/notifications";

  if (!message) {
    return NextResponse.json({ ok: false, error: "Notification message is required." }, { status: 400 });
  }

  try {
    let targetTokens: MobilePushTokenRecord[] = [];
    let recipientUserIds: string[] = [];

    if (targetMode === "user") {
      if (!targetUserId) {
        return NextResponse.json(
          { ok: false, error: "Specific target user is required in user mode." },
          { status: 400 },
        );
      }
      recipientUserIds = [targetUserId];
      targetTokens = (await listMobilePushTokens({ activeOnly: true, userId: targetUserId })).filter(
        (t) => matchesPlatform(t, platform),
      );
    } else {
      const allActiveTokens = await listMobilePushTokens({ activeOnly: true });
      targetTokens = allActiveTokens.filter(
        (t) => matchesAudience(t, audience) && matchesPlatform(t, platform),
      );
      recipientUserIds = Array.from(new Set(targetTokens.map((t) => t.userId)));
    }

    // 1. Create In-App Notifications for all target users so they are visible and tracked for read rate
    await Promise.allSettled(
      recipientUserIds.map((userId) =>
        createAppNotification({
          userId,
          title,
          message,
          type: "push_broadcast",
          entityType: "broadcast",
          metadata: {
            deepLinkUrl,
            sentBy: authorization.session.userId,
            targetMode,
            audience,
            sentAt: new Date().toISOString(),
          },
        }),
      ),
    );

    // 2. Dispatch FCM Push Notifications to active devices
    let pushResult = { attempted: 0, sent: 0, failed: 0 };
    if (targetTokens.length > 0) {
      const dispatch = await sendMobilePushNotifications(targetTokens, {
        title,
        body: message,
        data: {
          type: "push_broadcast",
          deepLinkUrl,
          notificationChannelId: "gigxomi-default",
          sentBy: authorization.session.userId,
        },
      });
      pushResult = {
        attempted: dispatch.attempted,
        sent: dispatch.sent,
        failed: dispatch.failed,
      };
    }

    return NextResponse.json({
      ok: true,
      targetMode,
      targetUserId: targetUserId || null,
      audience,
      platform,
      recipientsCount: recipientUserIds.length,
      matchedTokens: targetTokens.length,
      pushResult,
      message: `Notification dispatched to ${recipientUserIds.length} user(s) (${pushResult.sent} device pushes delivered).`,
    });
  } catch (error) {
    console.error("[push-send-api] Error sending push notification:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to send push notification." },
      { status: 500 },
    );
  }
}
