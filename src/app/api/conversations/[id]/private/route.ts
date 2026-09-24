import { NextResponse } from "next/server";

import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { updateConversationPrivacyFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const isPrivate = Boolean(body?.isPrivate);

  const existing = await getConversationViewForSession(authorization.session, id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  const conversation = await updateConversationPrivacyFromFile(id, isPrivate);
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Unable to update conversation privacy." }, { status: 409 });
  }

  const conversationView = await getConversationViewForSession(authorization.session, id);

  return NextResponse.json({
    ok: true,
    isPrivate,
    conversation: conversationView,
  });
}
