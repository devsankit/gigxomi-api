import { NextResponse } from "next/server";

import { getFreelancerConversationAccess } from "@/lib/api/conversation-access";
import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { setConversationTypingFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const role: "admin" | "manager" | "freelancer" | "sales" =
    authorization.session.role === "MANAGER"
      ? "manager"
      : authorization.session.role === "FREELANCER"
        ? "freelancer"
        : authorization.session.role === "SALES_AGENT"
          ? "sales"
          : "admin";
  const lane = body.lane === "internal" ? "internal" : "customer";

  if (role === "freelancer") {
    const access = await getFreelancerConversationAccess(authorization.session, id);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.reason === "missing" ? "Conversation not found." : "You do not have access to this conversation." },
        { status: access.reason === "missing" ? 404 : 403 },
      );
    }

    if (!access.canWriteInternalLane) {
      return NextResponse.json(
        { ok: false, error: "You are a read-only project viewer. Only the primary editor can reply." },
        { status: 403 },
      );
    }

    if (lane === "customer") {
      if (!access.conversation.freelancerCustomerLaneAccess) {
        return NextResponse.json(
          { ok: false, error: "Direct client chat is still waiting for admin or manager access on this thread." },
          { status: 403 },
        );
      }

      if (access.transport?.state === "blocked") {
        return NextResponse.json({ ok: false, error: access.transport.note }, { status: 409 });
      }
    }
  }

  if (role !== "freelancer" && !(await getConversationViewForSession(authorization.session, id))) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const conversation = await setConversationTypingFromFile(id, {
    role,
    lane,
    active: Boolean(body.active),
  });

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    conversation,
  });
}
