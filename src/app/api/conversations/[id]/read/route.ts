import { NextResponse } from "next/server";

import { freelancerCanAccessConversation } from "@/lib/api/conversation-access";
import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { markConversationReadFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  if (authorization.session.role === "FREELANCER" && !(await freelancerCanAccessConversation(authorization.session, id))) {
    return NextResponse.json({ ok: false, error: "You do not have access to this conversation." }, { status: 403 });
  }

  if (authorization.session.role !== "FREELANCER" && !(await getConversationViewForSession(authorization.session, id))) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const requestedLane = String(body?.lane ?? "").trim().toLowerCase();
  const lane = requestedLane === "customer" || requestedLane === "internal" ? requestedLane : undefined;
  const audience: "admin" | "manager" | "freelancer" | "sales" =
    authorization.session.role === "MANAGER"
      ? "manager"
      : authorization.session.role === "FREELANCER"
        ? "freelancer"
        : authorization.session.role === "SALES_AGENT"
          ? "sales"
          : "admin";
  const conversation = await markConversationReadFromFile(id, audience, lane);

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const conversationView = await getConversationViewForSession(authorization.session, id);

  return NextResponse.json({
    ok: true,
    conversation: conversationView,
  });
}
