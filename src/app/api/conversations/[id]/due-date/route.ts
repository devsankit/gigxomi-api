import { NextResponse } from "next/server";

import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { updateConversationDueDateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const rawDueDate = body?.dueDate !== undefined ? body.dueDate : null;
  const dueDate = rawDueDate ? String(rawDueDate).trim() : null;

  const existing = await getConversationViewForSession(authorization.session, id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  const conversation = await updateConversationDueDateFromFile(id, dueDate);
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Unable to update due date." }, { status: 409 });
  }

  const conversationView = await getConversationViewForSession(authorization.session, id);

  return NextResponse.json({
    ok: true,
    dueDate,
    conversation: conversationView,
  });
}
