import { NextResponse } from "next/server";

function getMobileFirebaseProjectId() {
  return process.env.FIREBASE_PROJECT_ID?.trim() || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || "gigxomi-516f1";
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    config: {
      channelId: "gigxomi-default",
      channels: {
        chat: "gigxomi-chat-messages-v2",
        project: "gigxomi-project-assignments",
        status: "gigxomi-status-updates",
        payment: "gigxomi-payment-updates",
        default: "gigxomi-default",
      },
      provider: "firebase-cloud-messaging",
      projectId: getMobileFirebaseProjectId(),
    },
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "",
  });
}

