import { NextResponse } from "next/server";

import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { getManagedAuthUsers } from "@/lib/auth/store";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { approveProjectIntakeAndOfferFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { resolveFreelancerPushRecipients } from "@/lib/gigxomi/freelancer-push-recipient";
import { getRequestOrigin, sendAssignmentPushToUser } from "@/lib/mobile/push-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (!(await getConversationViewForSession(authorization.session, id))) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const approvedByRole = authorization.session.role === "MANAGER" ? "manager" : "admin";
  const result = await approveProjectIntakeAndOfferFromFile(id, {
    approvedByRole,
    approvedByName: authorization.session.displayName,
    fallbackToCategory: body?.fallbackToCategory !== false,
  });

  if (!result) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const offeredEditorIds = (result.assignmentOffers ?? [])
    .filter((offer) => offer.status === "PENDING")
    .map((offer) => offer.freelancerId);
  const managedUsers = await getManagedAuthUsers();
  const tenantUsers = managedUsers.filter((user) => !result.tenantId || user.tenantId === result.tenantId);
  const recipients = resolveFreelancerPushRecipients(offeredEditorIds, tenantUsers);
  const deliveryTargets = await Promise.all(
    recipients.map(async (recipient) => {
      if (!recipient.pushUserId) {
        return { editorId: recipient.editorId, attempted: 0, failed: 0, sent: 0, status: "no_login_user" as const };
      }
      await createAppNotification({
        userId: recipient.pushUserId,
        tenantId: result.tenantId,
        type: "project_offer",
        title: "New project offer",
        message: `${authorization.session.displayName} approved a matching project. Open the app to accept or reject within 10 minutes.`,
        entityType: "conversation",
        entityId: id,
        metadata: { conversationId: id, editorId: recipient.editorId, source: "project_intake" },
      }).catch((error) => console.error("Failed to create intake-offer notification", error));
      const push = await sendAssignmentPushToUser({
        userId: recipient.pushUserId,
        payload: {
          assignmentId: id,
          conversationId: id,
          deepLinkUrl: `/chat?conversationId=${encodeURIComponent(id)}`,
          baseUrl: getRequestOrigin(request),
          title: "New matching project",
          body: "Gigxomi approved a project matching your category. Open the app to accept or reject.",
        },
      }).catch((error) => {
        console.error("Failed to dispatch intake-offer push notification", error);
        return { ok: false as const, attempted: 0, failed: 1, sent: 0, status: "dispatch_error" as const };
      });
      return { editorId: recipient.editorId, ...push };
    }),
  );

  return NextResponse.json({
    ok: true,
    notificationDelivery: {
      targeted: deliveryTargets.length,
      attempted: deliveryTargets.reduce((total, target) => total + target.attempted, 0),
      sent: deliveryTargets.reduce((total, target) => total + target.sent, 0),
      failed: deliveryTargets.reduce((total, target) => total + target.failed, 0),
    },
    conversation: await getConversationViewForSession(authorization.session, id),
  });
}
