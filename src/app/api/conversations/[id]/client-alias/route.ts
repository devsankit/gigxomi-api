import { NextResponse } from "next/server";

import { getFreelancerConversationAccess } from "@/lib/api/conversation-access";
import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { updateConversationFreelancerClientAliasFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const alias = String(body.alias ?? "").trim();

  if (!alias) {
    return NextResponse.json({ ok: false, error: "Client alias is required." }, { status: 400 });
  }

  if (authorization.session.role === "FREELANCER") {
    const access = await getFreelancerConversationAccess(authorization.session, id);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.reason === "missing" ? "Conversation not found." : "You do not have access to this conversation." },
        { status: access.reason === "missing" ? 404 : 403 },
      );
    }
  }

  const updated = await updateConversationFreelancerClientAliasFromFile(id, { alias });
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  if ("error" in updated) {
    return NextResponse.json({ ok: false, error: updated.error }, { status: 400 });
  }

  const conversation = await getConversationViewForSession(authorization.session, id, "freelancer");
  return NextResponse.json({ ok: true, conversation });
}
