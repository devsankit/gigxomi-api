import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { sendStandaloneWhatsAppMessageFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { listGappRegistrationsForFollowUp } from "@/lib/gigxomi/gapp-webinar-store";
import { buildWebinarGgJoinUrl, verifyOwnedWebinarGgEvent } from "@/lib/gigxomi/webinar-gg";

const SUPPORTED_EVENTS = new Set([
  "webinar.created",
  "webinar.updated",
  "webinar.started",
  "webinar.ended",
  "webinar.deleted",
  "webinar.user.invited",
  "webinar.user.uninvited",
  "webinar.recording.created",
]);
const EVENT_LOG_PATH = path.join(process.cwd(), ".gigxomi", "webinar-gg-events.jsonl");
const MAX_BODY_BYTES = 64 * 1024;
const recentEventKeys = new Set<string>();

type WebinarGgWebhook = {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function eventKey(payload: WebinarGgWebhook) {
  return createHash("sha256")
    .update(JSON.stringify({ data: payload.data, event: payload.event, timestamp: payload.timestamp }))
    .digest("hex");
}

async function wasPreviouslyProcessed(key: string) {
  if (recentEventKeys.has(key)) return true;
  const log = await readFile(EVENT_LOG_PATH, "utf8").catch(() => "");
  return log.includes(`\"key\":\"${key}\"`);
}

function notificationMessage(payload: WebinarGgWebhook, joinUrl: string) {
  const title = readString(payload.data.title) || "Gigxomi Agency Growth Workshop";
  if (payload.event === "webinar.user.invited") {
    return `Your registration for ${title} is confirmed. Webinar access: ${joinUrl}`;
  }
  if (payload.event === "webinar.started") {
    return `${title} is live now. Join here: ${joinUrl}`;
  }
  if (payload.event === "webinar.ended") {
    return `${title} has ended. Thank you for joining. We will share the follow-up and recording when available.`;
  }
  if (payload.event === "webinar.recording.created") {
    const replayUrl =
      readString(payload.data.mp4Url) ||
      readString(payload.data.mainUrl) ||
      readString(payload.data.m3u8Url) ||
      joinUrl;
    return `The recording for ${title} is ready. Watch here: ${replayUrl}`;
  }
  return "";
}

async function notifyRegistrants(payload: WebinarGgWebhook, webinarId: string) {
  const body = notificationMessage(payload, buildWebinarGgJoinUrl(webinarId));
  if (!body) return { attempted: 0, delivered: 0, failed: 0 };

  const { registrations } = await listGappRegistrationsForFollowUp(500);
  const invitedEmail = readString(payload.data.email).toLowerCase();
  const recipients = registrations.filter((registration) => {
    const confirmed = registration.status === "REGISTERED" || registration.status === "PAYMENT_SUCCESS";
    if (!confirmed) return false;
    return payload.event !== "webinar.user.invited" || registration.email.toLowerCase() === invitedEmail;
  });

  let delivered = 0;
  let failed = 0;
  for (let index = 0; index < recipients.length; index += 5) {
    const batch = recipients.slice(index, index + 5);
    const results = await Promise.allSettled(
      batch.map((registration) =>
        sendStandaloneWhatsAppMessageFromFile({
          tenantId: "tenant-gigxomi",
          to: registration.whatsappNumber,
          body,
        }),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.mode !== "whatsapp-failed") delivered += 1;
      else failed += 1;
    }
  }

  return { attempted: recipients.length, delivered, failed };
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "webinar-gg-webhook" });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!rawBody || Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Invalid webhook body." }, { status: 400 });
  }

  let payload: WebinarGgWebhook;
  try {
    payload = JSON.parse(rawBody) as WebinarGgWebhook;
  } catch {
    return NextResponse.json({ ok: false, error: "Webhook body must be valid JSON." }, { status: 400 });
  }
  const webinarId = readString(payload?.data?.webinarId);
  if (!payload || !SUPPORTED_EVENTS.has(payload.event) || !payload.timestamp || !webinarId) {
    return NextResponse.json({ ok: false, error: "Unsupported Webinar.gg payload." }, { status: 400 });
  }

  try {
    await verifyOwnedWebinarGgEvent(webinarId);
  } catch (error) {
    console.error("[webinar.gg] Webhook verification failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "Webhook could not be verified." }, { status: 401 });
  }

  const key = eventKey(payload);
  if (await wasPreviouslyProcessed(key)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  recentEventKeys.add(key);
  if (recentEventKeys.size > 1_000) recentEventKeys.delete(recentEventKeys.values().next().value ?? "");

  const notifications = await notifyRegistrants(payload, webinarId);
  await mkdir(path.dirname(EVENT_LOG_PATH), { recursive: true });
  await appendFile(
    EVENT_LOG_PATH,
    `${JSON.stringify({ event: payload.event, key, notifications, receivedAt: new Date().toISOString(), timestamp: payload.timestamp, webinarId })}\n`,
    "utf8",
  );

  return NextResponse.json({ ok: true, event: payload.event, notifications });
}
