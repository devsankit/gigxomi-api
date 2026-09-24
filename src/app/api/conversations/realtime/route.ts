import { NextResponse } from "next/server";

import {
  canReceiveConversationRealtimeEvent,
  listRecentConversationRealtimeEvents,
  subscribeConversationRealtimeEvents,
} from "@/lib/gigxomi/conversation-realtime";
import { requireSessionRole } from "@/lib/api/require-session-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function encodeEvent(eventName: string, payload: unknown) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const encoder = new TextEncoder();
  let closed = false;
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const send = (eventName: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeEvent(eventName, payload)));
      };

      send("conversation", { type: "connected", createdAt: new Date().toISOString() });

      const replayEvents = await listRecentConversationRealtimeEvents(authorization.session);
      replayEvents.forEach((event) => send("conversation", { ...event, replayed: true }));

      const unsubscribe = subscribeConversationRealtimeEvents((event) => {
        if (canReceiveConversationRealtimeEvent(event, authorization.session)) {
          send("conversation", event);
        }
      });

      const keepAlive = setInterval(() => {
        send("ping", { createdAt: new Date().toISOString() });
      }, 25_000);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The browser may already have closed the realtime stream.
        }
      };

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
