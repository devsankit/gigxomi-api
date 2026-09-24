import { NextResponse } from "next/server";

import { getConversationAccessForSession, getFreelancerConversationAccess } from "@/lib/api/conversation-access";
import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { sendConversationReviewFlowFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { projectConversation } from "@/lib/gigxomi/dummy-platform-store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const role = authorization.session.role === "FREELANCER" ? "freelancer" : authorization.session.role === "MANAGER" ? "manager" : "admin";
  const tenantAccess = await getConversationAccessForSession(authorization.session, id);
  if (!tenantAccess.ok) {
    return NextResponse.json(
      { ok: false, error: tenantAccess.reason === "missing" ? "Conversation not found." : "You do not have access to this conversation." },
      { status: tenantAccess.reason === "missing" ? 404 : 403 },
    );
  }

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
        { ok: false, error: "Only the primary editor can send the customer review form." },
        { status: 403 },
      );
    }
    if (!access.conversation.freelancerCustomerLaneAccess) {
      return NextResponse.json(
        { ok: false, error: "Direct client chat is still waiting for admin or manager access on this thread." },
        { status: 403 },
      );
    }
  }

  const result = await sendConversationReviewFlowFromFile(id, {
    actorRole: role,
    actorLabel: authorization.session.displayName,
  });

  if (!result) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  const conversationView = await getConversationViewForSession(authorization.session, id, role);

  return NextResponse.json({
    ok: result.delivery.ok,
    conversation: conversationView ?? projectConversation(result.conversation, role),
    delivery: result.delivery,
    error: result.delivery.ok ? undefined : result.delivery.error,
  }, { status: result.delivery.ok ? 200 : 502 });
}
