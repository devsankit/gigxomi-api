import { NextResponse } from "next/server";

import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { resolveFreelancerChatIdentity } from "@/lib/api/freelancer-chat-identity";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { getManagedAuthUsers } from "@/lib/auth/store";
import { assertActiveAssignmentEditorLimit, withAssignmentCapacityLock } from "@/lib/billing/team-seat-limits";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import { getConversationByIdFromFile, respondToConversationAssignmentFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { resolveFreelancerPushRecipients } from "@/lib/gigxomi/freelancer-push-recipient";
import { getRequestOrigin, sendAssignmentPushToUser } from "@/lib/mobile/push-service";

function hasErrorMessage(value: unknown): value is { error: string } {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return "error" in value;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "").trim().toUpperCase();
  const rejectionReason = String(body?.rejectionReason ?? body?.reason ?? "").trim();

  if (action !== "ACCEPT" && action !== "PASS") {
    return NextResponse.json({ ok: false, error: "Unsupported action. Use ACCEPT or PASS." }, { status: 400 });
  }

  const actorRole = authorization.session.role === "FREELANCER" ? "freelancer" : authorization.session.role === "MANAGER" ? "manager" : "admin";
  if (!(await getConversationViewForSession(authorization.session, id))) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }
  const conversationBeforeResponse = await getConversationByIdFromFile(id);
  const pendingOffersBeforeResponse = (conversationBeforeResponse?.assignmentOffers ?? []).filter((offer) => offer.status === "PENDING");
  const freelancerIdentity = authorization.session.role === "FREELANCER" ? resolveFreelancerChatIdentity(authorization.session) : null;

  const performResponse = async () => {
  if (action === "ACCEPT" && conversationBeforeResponse && freelancerIdentity) {
    const normalize = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    const matchingOffer = pendingOffersBeforeResponse.find(
      (offer) =>
        freelancerIdentity.candidateEditorIds.includes(offer.freelancerId) ||
        freelancerIdentity.candidateEditorNames.some((name) => normalize(name) && normalize(name) === normalize(offer.freelancerName)),
    );
    if (!matchingOffer) {
      return NextResponse.json({ ok: false, error: "No pending project offer was found for this editor." }, { status: 409 });
    }

    const managedUsersForCapacity = await getManagedAuthUsers();
    const agencyOwner = managedUsersForCapacity.find(
      (user) =>
        user.tenantId === conversationBeforeResponse.tenantId &&
        (user.role === "ADMIN" || user.assignedRole === "ADMIN"),
    );
    const capacity = await assertActiveAssignmentEditorLimit({
      tenantId: conversationBeforeResponse.tenantId,
      packageId: agencyOwner?.packageId,
      editorIds: [matchingOffer.freelancerId],
    });
    if (!capacity.ok) {
      return { capacity } as const;
    }
  }

  return respondToConversationAssignmentFromFile(id, {
    action,
    actorRole,
    actorName: authorization.session.displayName,
    actorUserId: authorization.session.userId,
    actorCandidateIds: freelancerIdentity?.candidateEditorIds,
    actorCandidateNames: freelancerIdentity?.candidateEditorNames,
    rejectionReason,
  });
  };

  const updated =
    action === "ACCEPT" && conversationBeforeResponse
      ? await withAssignmentCapacityLock(conversationBeforeResponse.tenantId, performResponse)
      : await performResponse();

  if (updated && "capacity" in updated) {
    return NextResponse.json(
      {
        ok: false,
        code: "EDITOR_ASSIGNMENT_LIMIT_REACHED",
        error: updated.capacity.error,
        limit: updated.capacity.limit,
        activeEditors: updated.capacity.activeSeats,
      },
      { status: 402 },
    );
  }

  if (!updated) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  if (hasErrorMessage(updated)) {
    return NextResponse.json({ ok: false, error: updated.error }, { status: 400 });
  }

  const conversationView = await getConversationViewForSession(authorization.session, id);
  const missedOffers =
    action === "ACCEPT"
      ? pendingOffersBeforeResponse.filter((offer) =>
          ("assignmentOffers" in updated ? updated.assignmentOffers ?? [] : []).some(
            (nextOffer) => nextOffer.id === offer.id && nextOffer.status === "EXPIRED" && nextOffer.expiredReason === "accepted_by_other",
          ),
        )
      : [];
  const managedUsers = missedOffers.length ? await getManagedAuthUsers() : [];
  const missedRecipients = resolveFreelancerPushRecipients(
    missedOffers.map((offer) => offer.freelancerId),
    managedUsers,
  );
  const missedDelivery = await Promise.all(
    missedRecipients.map(async (recipient) => {
      if (!recipient.pushUserId) {
        return { editorId: recipient.editorId, sent: 0, status: "no_login_user" as const };
      }
      await createAppNotification({
        userId: recipient.pushUserId,
        tenantId: conversationBeforeResponse?.tenantId,
        type: "project_offer_missed",
        title: "You missed this project",
        message: "Another editor accepted this project first. Stay online to receive the next matching offer.",
        entityType: "conversation",
        entityId: id,
        metadata: { conversationId: id, editorId: recipient.editorId },
      }).catch((error) => console.error("Failed to create missed-offer notification", error));
      const push = await sendAssignmentPushToUser({
        userId: recipient.pushUserId,
        payload: {
          assignmentId: id,
          conversationId: id,
          deepLinkUrl: `/chat?conversationId=${encodeURIComponent(id)}`,
          baseUrl: getRequestOrigin(request),
          eventType: "ASSIGNMENT_MISSED",
          title: "Oops, you missed this project",
          body: "Another editor accepted first. Stay online so you can earn from the next matching project.",
        },
      }).catch((error) => {
        console.error("Failed to dispatch missed-offer push notification", error);
        return { ok: false as const, attempted: 0, failed: 1, sent: 0, status: "dispatch_error" as const };
      });
      return { editorId: recipient.editorId, ...push };
    }),
  );

  return NextResponse.json({
    ok: true,
    action,
    missedNotificationDelivery: {
      targeted: missedDelivery.length,
      sent: missedDelivery.reduce((total, result) => total + result.sent, 0),
    },
    conversation: conversationView,
  });
}
