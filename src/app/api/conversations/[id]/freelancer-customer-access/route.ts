import { NextResponse } from "next/server";

import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { updateFreelancerCustomerLaneAccessFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const enabled = Boolean(body?.enabled);
  const grantedByRole = authorization.session.role === "MANAGER" ? "manager" : "admin";
  const grantedByName = authorization.session.displayName || (grantedByRole === "manager" ? "Manager" : "Admin");
  if (!(await getConversationViewForSession(authorization.session, id))) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  const conversation = await updateFreelancerCustomerLaneAccessFromFile(id, {
    enabled,
    grantedByRole,
    grantedByName,
  });

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  if ("error" in conversation) {
    return NextResponse.json({ ok: false, error: conversation.error }, { status: 400 });
  }

  const conversationView = await getConversationViewForSession(authorization.session, id);

  return NextResponse.json({
    ok: true,
    conversation: conversationView,
  });
}
