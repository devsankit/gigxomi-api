import { NextResponse } from "next/server";

import { resolveConversationAudienceForSession } from "@/lib/api/conversation-access";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { resolveSessionTenantId, resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { listConversationsForAudienceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import type { DummyConversationRole, DummyConversationView } from "@/lib/gigxomi/dummy-platform-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const CHAT_ACTIVITY_CHECK_MS = 3500;
const INTERNAL_AUDIENCES = new Set(["admin", "manager", "freelancer", "sales"]);

function isInternalAudience(value: string | null): value is DummyConversationRole {
  return Boolean(value && INTERNAL_AUDIENCES.has(value));
}

function getLatestMessageFingerprint(conversation: DummyConversationView) {
  const latestMessage = conversation.messages.at(-1);
  if (!latestMessage) {
    return "no-message";
  }

  return [
    latestMessage.id,
    latestMessage.createdAt,
    latestMessage.senderRole,
    latestMessage.lane,
    latestMessage.body.length,
    latestMessage.attachments?.length ?? 0,
    latestMessage.deliveryStatus ?? "",
  ].join(":");
}

function buildConversationActivitySignature(conversations: DummyConversationView[]) {
  return conversations
    .map((conversation) =>
      [
        conversation.id,
        conversation.status,
        conversation.leadStatusId,
        conversation.assignedFreelancerId ?? "",
        conversation.assignedFreelancerName ?? "",
        conversation.ownerName ?? "",
        conversation.lastCustomerActivityAt,
        conversation.unreadCount,
        conversation.unreadCountByLane.customer,
        conversation.unreadCountByLane.internal,
        conversation.messages.length,
        getLatestMessageFingerprint(conversation),
      ].join("|"),
    )
    .sort()
    .join("\n");
}

function hashConversationActivitySignature(signature: string) {
  let hash = 0;
  for (let index = 0; index < signature.length; index += 1) {
    hash = Math.imul(31, hash) + signature.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { searchParams } = new URL(request.url);
  const requestedAudience = searchParams.get("audience");
  const normalizedAudience = isInternalAudience(requestedAudience) ? requestedAudience : undefined;
  const scope = resolveConversationAudienceForSession(authorization.session, normalizedAudience);
  const tenantId =
    authorization.session.role === "SUPER_ADMIN"
      ? "tenant-gigxomi"
      : authorization.session.role === "SALES_AGENT"
        ? resolveWhatsAppSetupTenantId(authorization.session)
      : resolveSessionTenantId(authorization.session);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastSignature = "";
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const enqueue = (chunk: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(chunk));
        }
      };

      const cleanup = () => {
        closed = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        try {
          controller.close();
        } catch {
          // The stream may already be closed if the browser disconnected.
        }
      };

      function scheduleNextCheck() {
        if (!closed) {
          timeoutId = setTimeout(checkForConversationActivity, CHAT_ACTIVITY_CHECK_MS);
        }
      }

      async function checkForConversationActivity() {
        if (closed) {
          return;
        }

        try {
          const payload = await listConversationsForAudienceFromFile(scope.audience, {
            freelancerId: scope.freelancerId,
            freelancerIds: scope.freelancerIds,
            freelancerNames: scope.freelancerNames,
            activeAgencyIds: scope.activeAgencyIds,
            tenantId,
            includeSupportData: false,
          });
          const signature = buildConversationActivitySignature(payload.conversations);
          const changed = Boolean(lastSignature && lastSignature !== signature);
          lastSignature = signature;

          enqueue(
            encodeSse(changed ? "sync" : "heartbeat", {
              ok: true,
              audience: scope.audience,
              signature: changed ? hashConversationActivitySignature(signature) : undefined,
              checkedAt: new Date().toISOString(),
            }),
          );
        } catch {
          enqueue(
            encodeSse("heartbeat", {
              ok: false,
              checkedAt: new Date().toISOString(),
            }),
          );
        } finally {
          scheduleNextCheck();
        }
      }

      request.signal.addEventListener("abort", cleanup, { once: true });
      enqueue("retry: 5000\n\n");
      enqueue(
        encodeSse("ready", {
          ok: true,
          audience: scope.audience,
          checkedAt: new Date().toISOString(),
        }),
      );
      void checkForConversationActivity();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
