import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getConversationAccessForSession } from "@/lib/api/conversation-access";
import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { deleteConversationMessageForEveryoneFromFile, deliverConversationMessageFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { getConversationById, projectConversation, type DummyMessageAttachmentInput } from "@/lib/gigxomi/dummy-platform-store";
import { sendMobileChatPushForConversation } from "@/lib/mobile-chat-push";
import { publishConversationRealtimeEvent, resolveConversationRealtimeRecipients } from "@/lib/gigxomi/conversation-realtime";

const MAX_CHAT_ATTACHMENT_BYTES = 20 * 1024 * 1024;

async function persistInlineAttachmentUrl(externalUrl?: string): Promise<string | undefined> {
  if (!externalUrl || !externalUrl.startsWith("data:")) {
    return externalUrl;
  }
  const match = externalUrl.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (!match) return externalUrl;

  const mimeType = match[1];
  const b64 = match[2].replace(/\s+/g, "");

  let ext = "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
  else if (mimeType.includes("webp")) ext = "webp";
  else if (mimeType.includes("gif")) ext = "gif";
  else if (mimeType.includes("svg")) ext = "svg";
  else if (mimeType.includes("pdf")) ext = "pdf";

  try {
    const uploadDir = path.join(process.cwd(), "public", "uploads", "chat-media");
    await mkdir(uploadDir, { recursive: true });
    const fileName = `chat_${randomBytes(8).toString("hex")}.${ext}`;
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, Buffer.from(b64, "base64"));
    return `/uploads/chat-media/${fileName}`;
  } catch (err) {
    console.error("[persistInlineAttachmentUrl] Failed to save inline data URL to disk:", err);
    return externalUrl;
  }
}

function normalizeAttachments(value: unknown): { attachments: DummyMessageAttachmentInput[]; invalid: boolean } {
  if (!Array.isArray(value)) {
    return { attachments: [], invalid: false };
  }

  const attachments: DummyMessageAttachmentInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { attachments: [], invalid: true };
    }
    const candidate = item as Record<string, unknown>;
    const name = String(candidate.name ?? "").trim();
    if (!name) {
      return { attachments: [], invalid: true };
    }

    const rawSize = candidate.sizeBytes;
    const sizeBytes =
      typeof rawSize === "number" && Number.isFinite(rawSize) ? Math.max(0, Math.floor(rawSize)) : undefined;
    if (typeof sizeBytes === "number" && sizeBytes > MAX_CHAT_ATTACHMENT_BYTES) {
      return { attachments: [], invalid: true };
    }

    attachments.push({
      name,
      mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : undefined,
      sizeBytes,
      uploadTarget: candidate.uploadTarget === "youtube" ? "youtube" : "local",
      durationSeconds:
        typeof candidate.durationSeconds === "number" && Number.isFinite(candidate.durationSeconds)
          ? Math.max(0, Math.floor(candidate.durationSeconds))
          : undefined,
      note: typeof candidate.note === "string" ? candidate.note : undefined,
      externalUrl: typeof candidate.externalUrl === "string" ? candidate.externalUrl : undefined,
    });
  }

  return { attachments, invalid: false };
}

function normalizeClientMessageId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 && normalized.length <= 160 ? normalized : undefined;
}

function normalizeMessageId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 && normalized.length <= 160 ? normalized : "";
}

function isLikelyRapidDuplicate(input: {
  body: string;
  lane: "customer" | "internal";
  role: "admin" | "manager" | "freelancer" | "sales";
  recentMessages: Array<{
    body?: string;
    createdAt?: string;
    lane?: string;
    senderRole?: string;
  }>;
}) {
  const body = input.body.trim();
  if (!body) {
    return false;
  }

  const latest = [...input.recentMessages]
    .sort((left, right) => new Date(right.createdAt ?? "").getTime() - new Date(left.createdAt ?? "").getTime())
    .find((message) => message.senderRole === input.role && message.lane === input.lane);
  if (!latest) {
    return false;
  }

  const latestBody = String(latest.body ?? "").trim();
  if (!latestBody || latestBody !== body) {
    return false;
  }

  const createdAtMs = new Date(latest.createdAt ?? "").getTime();
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  return Date.now() - createdAtMs <= 4_000;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const conversation = await getConversationViewForSession(authorization.session, id, searchParams.get("audience"));

  if (!conversation) {
    return NextResponse.json({ ok: false, conversation: null, error: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    conversation,
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const normalizedAttachments = normalizeAttachments(body?.attachments);
  if (normalizedAttachments.invalid) {
    return NextResponse.json({ ok: false, error: "Only files up to 20 MB are allowed." }, { status: 400 });
  }

  const role: "admin" | "manager" | "freelancer" | "sales" =
    authorization.session.role === "MANAGER"
      ? "manager"
      : authorization.session.role === "FREELANCER"
        ? "freelancer"
        : authorization.session.role === "SALES_AGENT"
          ? "sales"
          : "admin";
  const canManage = role === "admin" || role === "manager";
  const lane = body?.lane === "internal" ? "internal" : "customer";
  const visibility = canManage && body?.visibility === "client_private" ? "client_private" : undefined;
  const clientMessageId = normalizeClientMessageId(body?.clientMessageId);
  const tenantAccess = await getConversationAccessForSession(authorization.session, id);
  if (!tenantAccess.ok) {
    return NextResponse.json(
      { ok: false, error: tenantAccess.reason === "missing" ? "Conversation not found." : "You do not have access to this conversation." },
      { status: tenantAccess.reason === "missing" ? 404 : 403 },
    );
  }

  const { permissions, conversation, transport } = tenantAccess;

  if (body?.action !== "delete-message") {
    if (lane === "customer") {
      if (!permissions.canSendCustomerMessage) {
        let errorMessage = "You do not have permission to send messages in the customer lane.";
        if (role === "freelancer") {
          if (!conversation?.freelancerCustomerLaneAccess) {
            errorMessage = "Direct client chat is still waiting for admin or manager access on this thread.";
          } else if (transport?.state === "blocked") {
            errorMessage = transport.note || "Customer delivery relay is not active for this agency yet.";
          } else {
            errorMessage = "You are a read-only project viewer. Only the primary editor can reply.";
          }
        }
        return NextResponse.json({ ok: false, error: errorMessage }, { status: 403 });
      }

      if (role === "freelancer" && normalizedAttachments.attachments.length) {
        return NextResponse.json(
          { ok: false, error: "Freelancer customer-lane replies are text-only right now. Use internal coordination for files or voice notes." },
          { status: 400 },
        );
      }
    }

    if (lane === "internal") {
      if (!permissions.canSendInternalMessage) {
        const errorMessage =
          role === "freelancer"
            ? "You are a read-only project viewer. Only the primary editor can reply."
            : "You do not have permission to send messages in the internal lane.";
        return NextResponse.json({ ok: false, error: errorMessage }, { status: 403 });
      }
    }
  }

  if (body?.action === "delete-message") {
    const messageId = normalizeMessageId(body?.messageId);
    if (!messageId) {
      return NextResponse.json({ ok: false, error: "Message id is required." }, { status: 400 });
    }

    const conversation = getConversationById(id);
    const message = conversation?.messages.find((item) => item.id === messageId);
    if (!conversation || !message) {
      return NextResponse.json({ ok: false, error: "Message not found." }, { status: 404 });
    }

    const canDelete = canManage || message.senderRole === role;
    if (!canDelete) {
      return NextResponse.json({ ok: false, error: "You can only delete your own messages." }, { status: 403 });
    }

    const result = await deleteConversationMessageForEveryoneFromFile(id, messageId, {
      deletedByRole: role,
      deletedByUserId: authorization.session.userId,
    });

    if (!result || "error" in result) {
      return NextResponse.json({ ok: false, error: "Message not found." }, { status: 404 });
    }

    const conversationView = await getConversationViewForSession(authorization.session, id, role);

    return NextResponse.json({
      ok: true,
      conversation: conversationView ?? projectConversation(result.conversation, role),
      deletedMessageId: messageId,
      scope: "everyone",
      meta: {
        supported: result.metaDeleteSupported,
        synced: result.metaDeleteSynced,
        note: result.metaDeleteNote,
      },
    });
  }

  const wasDuplicateClientMessage = Boolean(
    clientMessageId && getConversationById(id)?.messages.some((message) => message.clientMessageId === clientMessageId),
  );
  if (wasDuplicateClientMessage) {
    const conversationView = await getConversationViewForSession(authorization.session, id, role);
    return NextResponse.json({
      ok: true,
      conversation: conversationView,
      delivery: {
        ok: true,
        mode: "local-only",
        deduped: true,
      },
      mobilePush: { sent: 0, skipped: "duplicate_client_message" as const },
    });
  }
  const rapidDuplicate = isLikelyRapidDuplicate({
    body: typeof body?.body === "string" ? body.body : "",
    lane,
    role,
    recentMessages: getConversationById(id)?.messages ?? [],
  });

  if (rapidDuplicate && !normalizedAttachments.attachments.length) {
    const conversationView = await getConversationViewForSession(authorization.session, id, role);
    return NextResponse.json({
      ok: true,
      conversation: conversationView,
      delivery: {
        ok: true,
        mode: "local-only",
        deduped: true,
      },
      mobilePush: { sent: 0, skipped: "rapid_duplicate" as const },
    });
  }

  const sanitizedAttachments = await Promise.all(
    normalizedAttachments.attachments.map(async (attachment) => ({
      ...attachment,
      externalUrl: await persistInlineAttachmentUrl(attachment.externalUrl),
    })),
  );

  const result = await deliverConversationMessageFromFile(id, {
    role,
    lane,
    body: typeof body?.body === "string" ? body.body : "",
    attachments: sanitizedAttachments,
    visibility,
    clientMessageId,
  });

  if (!result) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const realtimeUserIds = resolveConversationRealtimeRecipients(
    result.conversation ?? { tenantId: "" },
    { visibility, lane },
  );

  await publishConversationRealtimeEvent({
    conversationId: id,
    eventType: "message-created",
    tenantId: result.conversation?.tenantId ?? null,
    userIds: realtimeUserIds,
    visibility,
  });

  const latestMessage = [...(result.conversation?.messages ?? [])].sort((left, right) => {
    const leftTime = new Date(left.createdAt ?? "").getTime();
    const rightTime = new Date(right.createdAt ?? "").getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  })[0];

  const mobilePush = await sendMobileChatPushForConversation({
    conversationId: id,
    messageBody: typeof body?.body === "string" ? body.body : "",
    messageId: latestMessage?.id,
    lane,
    senderId: authorization.session.userId,
    senderRole: role,
  }).catch((error) => ({
    error: error instanceof Error ? error.message : "Mobile push failed.",
    sent: 0,
  }));

  const conversationView = await getConversationViewForSession(authorization.session, id, role);

  return NextResponse.json({
    ok: true,
    conversation: conversationView ?? (result.conversation ? projectConversation(result.conversation, role) : null),
    delivery: result.delivery,
    mobilePush,
  });
}
