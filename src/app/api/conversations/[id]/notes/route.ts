import { NextResponse } from "next/server";

import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { updateConversationInternalNotesFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json();
  if (!(await getConversationViewForSession(authorization.session, id))) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const conversation = await updateConversationInternalNotesFromFile(id, typeof body.notes === "string" ? body.notes : "");

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Unable to update notes" }, { status: 404 });
  }

  const conversationView = await getConversationViewForSession(authorization.session, id);

  return NextResponse.json({
    ok: true,
    notes: conversation.internalNotes,
    conversation: conversationView,
  });
}
