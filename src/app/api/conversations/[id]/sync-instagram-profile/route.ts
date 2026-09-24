import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { getConversationById, getInstagramConnectionState } from "@/lib/gigxomi/dummy-platform-store";
import { fetchInstagramUserProfile } from "@/lib/gigxomi/meta-instagram";
import { updateConversationCustomerNameFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const conversation = getConversationById(id);
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    customName?: string;
  };

  // If agency owner provided a custom name directly:
  if (typeof body.customName === "string" && body.customName.trim()) {
    await updateConversationCustomerNameFromFile(id, body.customName.trim());
    const view = await getConversationViewForSession(authorization.session, id);
    return NextResponse.json({ ok: true, conversation: view, updatedName: body.customName.trim() });
  }

  if (conversation.sourceChannel !== "instagram" || !conversation.instagramScopedUserId) {
    return NextResponse.json({ ok: false, error: "Not an Instagram conversation or missing scoped user ID." }, { status: 400 });
  }

  const tenantId = conversation.tenantId || "tenant-gigxomi";
  const connection = getInstagramConnectionState(tenantId);
  const resolvedToken =
    connection?.accessToken?.trim() ||
    process.env.INSTAGRAM_ACCESS_TOKEN?.trim() ||
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN?.trim() ||
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim() ||
    "";

  if (!resolvedToken) {
    return NextResponse.json({ ok: false, error: "Instagram access token is missing in agency integration settings." }, { status: 400 });
  }

  const profileResult = await fetchInstagramUserProfile({
    accessToken: resolvedToken,
    scopedUserId: conversation.instagramScopedUserId,
    graphApiVersion: connection?.graphApiVersion,
  });

  if (!profileResult.ok) {
    return NextResponse.json({
      ok: false,
      error: profileResult.error || "Meta could not resolve Instagram handle for this customer ID.",
    }, { status: 502 });
  }

  const resolvedName = profileResult.username
    ? (profileResult.username.startsWith("@") ? profileResult.username : `@${profileResult.username}`)
    : profileResult.name || "Instagram Customer";

  await updateConversationCustomerNameFromFile(id, resolvedName);
  const view = await getConversationViewForSession(authorization.session, id);

  return NextResponse.json({
    ok: true,
    resolvedName,
    profile: profileResult,
    conversation: view,
  });
}
