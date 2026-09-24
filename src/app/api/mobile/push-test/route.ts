import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { listMobilePushTokens, sendMobilePushNotifications } from "@/lib/mobile-push-store";

type PushTestBody = {
  deepLinkUrl?: unknown;
  message?: unknown;
  platform?: unknown;
  title?: unknown;
  token?: unknown;
  type?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!auth.ok) {
    return auth.response;
  }

  let body: PushTestBody = {};
  try {
    body = (await request.json()) as PushTestBody;
  } catch {
    // Optional body
  }

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Gigxomi Notification";
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim() : "Test push alert from Gigxomi.";
  const deepLinkUrl = typeof body.deepLinkUrl === "string" && body.deepLinkUrl.trim() ? body.deepLinkUrl.trim() : "/notifications";
  const explicitToken = typeof body.token === "string" ? body.token.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "system";

  let tokens = await listMobilePushTokens({ activeOnly: true, userId: auth.session.userId });

  if (explicitToken) {
    const matched = tokens.filter((t) => t.token === explicitToken);
    if (matched.length > 0) {
      tokens = matched;
    } else {
      tokens = [
        {
          id: `test-${Date.now()}`,
          provider: "fcm",
          userId: auth.session.userId,
          tenantId: auth.session.tenantId,
          platform: body.platform === "ios" ? "ios" : "android",
          projectOfferChannelId: "gigxomi-project-offers-v6",
          supportsProjectOfferActions: true,
          token: explicitToken,
          tokenHash: explicitToken,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          disabledAt: null,
        },
      ];
    }
  }

  if (!tokens.length) {
    return NextResponse.json({
      ok: false,
      targetUserId: auth.session.userId,
      sent: 0,
      error: "No active push notification tokens registered for this user.",
      diagnostics: { activeTokenCount: 0 },
    });
  }

  const result = await sendMobilePushNotifications(tokens, {
    title,
    body: message,
    data: {
      type,
      deepLinkUrl,
      notificationChannelId: type === "chat" ? "gigxomi-chat-messages-v2" : "gigxomi-default",
    },
  });

  return NextResponse.json({
    ok: result.sent > 0,
    targetUserId: auth.session.userId,
    sent: result.sent,
    diagnostics: { tokenCount: tokens.length, failed: result.failed, attempted: result.attempted },
    error: result.errors.length ? JSON.stringify(result.errors[0]) : undefined,
  });
}
