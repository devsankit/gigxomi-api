import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getLastInboundPushDispatchSummaryFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { getMobilePushStoreDiagnostics, listMobilePushTokens, type MobilePushTokenRecord } from "@/lib/mobile-push-store";
import { getLastAssignmentPushDispatchSummary } from "@/lib/mobile/push-service";
import { getFirebaseAdminError, getFirebaseAdminMessaging } from "@/lib/web-push/firebase-admin";

const ALLOWED_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"] as const;
const MOBILE_NOTIFICATION_CHANNELS = {
  chat: "gigxomi-chat-messages-v2",
  project: "gigxomi-project-offers-v6",
  status: "gigxomi-status-updates",
  payment: "gigxomi-payment-updates",
  default: "gigxomi-default",
} as const;

function maskToken(token: string) {
  if (token.length <= 16) {
    return token;
  }
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

export async function GET() {
  let failedStage = "unknown";
  try {
    failedStage = "auth";
    const authorization = await requireSessionRole([...ALLOWED_ROLES]);
    if (!authorization.ok) {
      return authorization.response;
    }

    failedStage = "tokens";
    const allTokens = await listMobilePushTokens({ activeOnly: true });
    const tokens = allTokens.filter((item) => item.userId === authorization.session.userId);
    const byPlatform = {
      android: allTokens.filter((item) => item.platform === "android").length,
      ios: allTokens.filter((item) => item.platform === "ios").length,
      web: allTokens.filter((item) => item.platform === "web").length,
    };
    const tokenStats = {
      byPlatform,
      totalActiveTokens: allTokens.length,
      totalActiveUsers: new Set(allTokens.map((item) => item.userId)).size,
    };

    failedStage = "inbound_dispatch";
    const lastInboundDispatch = getLastInboundPushDispatchSummaryFromFile();
    const lastAssignmentDispatch = getLastAssignmentPushDispatchSummary();

    failedStage = "firebase_admin";
    let firebaseMessaging: ReturnType<typeof getFirebaseAdminMessaging> = null;
    let firebaseAdminError = "";
    try {
      firebaseMessaging = getFirebaseAdminMessaging();
      firebaseAdminError = getFirebaseAdminError();
    } catch (error) {
      firebaseAdminError = error instanceof Error ? error.message : String(error);
    }

    failedStage = "storage_diag";
    const storage = await getMobilePushStoreDiagnostics();

    failedStage = "env_read";
    const serviceAccountFile = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim() ?? "";
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ?? "";
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? "";
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim() ?? "";
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim() ?? "";

    return NextResponse.json({
      ok: true,
      user: {
        id: authorization.session.userId,
        role: authorization.session.role,
      },
      push: {
        activeTokenCount: tokens.length,
        channels: MOBILE_NOTIFICATION_CHANNELS,
        chatChannelId: MOBILE_NOTIFICATION_CHANNELS.chat,
        currentUserFcmTokenCount: tokens.length,
        global: {
          ...tokenStats,
          currentUserActionCapableTokens: tokens.filter((item) => item.supportsProjectOfferActions).length,
        },
        tokens: tokens.map((item: MobilePushTokenRecord) => ({
          platform: item.platform,
          projectOfferChannelId: item.projectOfferChannelId,
          supportsProjectOfferActions: item.supportsProjectOfferActions,
          tokenMasked: maskToken(item.token),
          lastSeenAt: item.updatedAt,
        })),
      },
      inboundDispatch: {
        last: lastInboundDispatch,
      },
      assignmentDispatch: {
        last: lastAssignmentDispatch?.userId === authorization.session.userId ? lastAssignmentDispatch : null,
      },
      firebaseAdmin: {
        available: Boolean(firebaseMessaging),
        error: firebaseAdminError || undefined,
        env: {
          hasServiceAccountFile: Boolean(serviceAccountFile),
          hasServiceAccountJson: Boolean(serviceAccountJson),
          hasProjectId: Boolean(projectId),
          hasClientEmail: Boolean(clientEmail),
          hasPrivateKey: Boolean(privateKey),
        },
      },
      storage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: `Push debug failed at ${failedStage}: ${message}`,
        code: "push_debug_failed",
        stage: failedStage,
        message,
      },
      { status: 500 },
    );
  }
}
