import { NextResponse } from "next/server";

import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import type { ManagedAuthUser } from "@/lib/auth/types";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { getManagedAuthUsers } from "@/lib/auth/store";
import { assertActiveAssignmentEditorLimit, withAssignmentCapacityLock } from "@/lib/billing/team-seat-limits";
import { findConfirmedAgencyEditorForManagedUser } from "@/lib/gigxomi/agency-editor-eligibility";
import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import {
  addConversationFreelancerCollaboratorsFromFile,
  assignConversationDirectlyFromFile,
  assignConversationFromFile,
  unassignConversationEditorsFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { resolveFreelancerPushRecipients } from "@/lib/gigxomi/freelancer-push-recipient";
import { prisma } from "@/lib/prisma";
import {
  getRequestOrigin,
  sendAssignmentPushToUser,
  sendAssignmentStatusPushToUser,
  sendInboundMessagePushToUser,
} from "@/lib/mobile/push-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json();
  const assignedBy = authorization.session.role === "MANAGER" ? "manager" : "admin";
  const currentConversationView = await getConversationViewForSession(authorization.session, id);
  if (!currentConversationView) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const requestedFreelancerIds: string[] = Array.from(
    new Set(
      (Array.isArray(body.freelancerIds) ? body.freelancerIds : [body.freelancerId])
        .map((value: unknown) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
  if (!requestedFreelancerIds.length) {
    return NextResponse.json({ ok: false, error: "Choose at least one freelancer from this agency workspace." }, { status: 400 });
  }
  const requestedMode = String(body.assignmentMode ?? "").trim().toLowerCase();
  const hasPrimaryEditor = Boolean(currentConversationView.assignmentSummary?.assignedFreelancerId);
  if (hasPrimaryEditor && requestedMode !== "replace" && requestedMode !== "viewer" && requestedMode !== "direct") {
    return NextResponse.json(
      {
        ok: false,
        assignmentDecisionRequired: true,
        assignedFreelancerId: currentConversationView.assignmentSummary?.assignedFreelancerId,
        assignedFreelancerName: currentConversationView.assignmentSummary?.assignedFreelancerName,
        error: "This project already has a primary editor. Choose Replace primary or Add as read-only viewer.",
      },
      { status: 409 },
    );
  }
  if (!hasPrimaryEditor && requestedMode === "viewer") {
    return NextResponse.json({ ok: false, error: "Assign a primary editor before adding lane viewers." }, { status: 409 });
  }
  if (requestedMode === "replace" && requestedFreelancerIds.length !== 1) {
    return NextResponse.json({ ok: false, error: "Choose exactly one editor for a primary replacement offer." }, { status: 400 });
  }
  if (requestedMode === "direct" && requestedFreelancerIds.length !== 1) {
    return NextResponse.json({ ok: false, error: "Choose exactly one editor for direct assignment." }, { status: 400 });
  }
  const projectDetails = String(body.projectDetails ?? "").trim();
  const dispatchRequestId = crypto.randomUUID();
  const conversationTenantId = currentConversationView.agencyContext?.tenantId || authorization.session.tenantId?.trim() || "";
  if (!conversationTenantId) {
    return NextResponse.json({ ok: false, error: "This conversation is not attached to an agency workspace." }, { status: 409 });
  }
  const [managedUsers, legacyMemberships, appMemberships, managerUsers] = await Promise.all([
    getManagedAuthUsers(),
    prisma.teamMembership.findMany({
      where: { tenantId: conversationTenantId, status: "ACTIVE", assignmentEligible: true },
      include: { editorProfile: { include: { user: true } } },
    }),
    prisma.appTeamMembership.findMany({ where: { tenantId: conversationTenantId, status: "ACTIVE" } }),
    prisma.appAuthUser.findMany({
      where: { tenantId: conversationTenantId, role: "MANAGER" },
      select: { id: true, displayName: true, email: true, phone: true },
    }),
  ]);
  const confirmedEditors = [
    ...legacyMemberships.map((membership) => ({
      editorProfileId: membership.editorProfileId,
      displayName: membership.editorProfile.user.displayName,
      email: membership.editorProfile.user.email,
      phone: membership.editorProfile.user.phone,
    })),
    ...appMemberships.map((membership) => ({
      editorProfileId: membership.freelancerId,
      displayName: membership.freelancerName,
    })),
    ...managerUsers.map((mgr) => ({
      editorProfileId: mgr.id,
      displayName: mgr.displayName,
      email: mgr.email,
      phone: mgr.phone,
    })),
  ];
  const teamManagedUsers = managedUsers.filter((user: ManagedAuthUser) =>
    Boolean(findConfirmedAgencyEditorForManagedUser(user, confirmedEditors)),
  );
  const generalManagedUsers = managedUsers.filter(
    (user: ManagedAuthUser) =>
      (user.role === "FREELANCER" || user.assignedRole === "FREELANCER") &&
      user.packageStatus !== "PAUSED" &&
      user.packageStatus !== "EXPIRED",
  );
  const offerManagedUsers = [...teamManagedUsers, ...generalManagedUsers].filter(
    (user, index, users) => users.findIndex((candidate) => candidate.id === user.id) === index,
  );
  const requiresTeamMembership = requestedMode === "direct" || requestedMode === "viewer";
  const eligibleManagedUsers = requiresTeamMembership ? teamManagedUsers : offerManagedUsers;
  const matchedFreelancers = resolveFreelancerPushRecipients(requestedFreelancerIds, eligibleManagedUsers);
  if (matchedFreelancers.length !== requestedFreelancerIds.length) {
    return NextResponse.json(
      {
        ok: false,
        error: requiresTeamMembership
          ? "Direct assignment is available only for active editors in this agency Team."
          : "Choose active Gigxomi freelancer accounts before sending an offer.",
      },
      { status: 403 },
    );
  }

  const capacity = await assertActiveAssignmentEditorLimit({
    tenantId: conversationTenantId,
    packageId: authorization.session.packageId,
    editorIds: matchedFreelancers.map((freelancer) => freelancer.editorId),
  });
  if (!capacity.ok) {
    return NextResponse.json(
      { ok: false, code: "EDITOR_ASSIGNMENT_LIMIT_REACHED", error: capacity.error, limit: capacity.limit, activeEditors: capacity.activeSeats },
      { status: 402 },
    );
  }

  if (requestedMode === "direct") {
    const freelancer = matchedFreelancers[0];
    const previousPrimaryId = currentConversationView.assignmentSummary?.assignedFreelancerId;
    const previousPrimaryName = currentConversationView.assignmentSummary?.assignedFreelancerName;
    const pendingOffers = (currentConversationView.assignmentSummary?.offers ?? []).filter((offer) => offer.status === "PENDING");
    const wasAlreadyPrimary = previousPrimaryId === freelancer.editorId;
    const directResult = await withAssignmentCapacityLock(conversationTenantId, async () => {
      const lockedCapacity = await assertActiveAssignmentEditorLimit({
        tenantId: conversationTenantId,
        packageId: authorization.session.packageId,
        editorIds: [freelancer.editorId],
      });
      if (!lockedCapacity.ok) return { capacity: lockedCapacity, conversation: null };
      const conversation = await assignConversationDirectlyFromFile(id, freelancer.editorId, assignedBy, {
        assignedByName: authorization.session.displayName,
        freelancerName: freelancer.displayName,
        projectDetails,
      });
      return { capacity: null, conversation };
    });
    if (directResult.capacity) {
      return NextResponse.json(
        {
          ok: false,
          code: "EDITOR_ASSIGNMENT_LIMIT_REACHED",
          error: directResult.capacity.error,
          limit: directResult.capacity.limit,
          activeEditors: directResult.capacity.activeSeats,
        },
        { status: 402 },
      );
    }
    const conversation = directResult.conversation;
    if (!conversation) {
      return NextResponse.json({ ok: false, error: "Unable to assign this editor directly." }, { status: 409 });
    }

    const affectedEditorIds = Array.from(
      new Set(
        [
          freelancer.editorId,
          previousPrimaryId && previousPrimaryId !== freelancer.editorId ? previousPrimaryId : "",
          ...pendingOffers.map((offer) => offer.freelancerId),
        ].filter(Boolean),
      ),
    );
    const affectedFreelancers = resolveFreelancerPushRecipients(affectedEditorIds, offerManagedUsers);
    const notificationTargets = await Promise.all(
      affectedFreelancers.map(async (recipient) => {
        const isSelectedPrimary = recipient.editorId === freelancer.editorId;
        const isPreviousPrimary = recipient.editorId === previousPrimaryId && !isSelectedPrimary;
        const pendingOffer = pendingOffers.find((offer) => offer.freelancerId === recipient.editorId);
        const title = isSelectedPrimary
          ? "Project assigned directly"
          : isPreviousPrimary
            ? "Primary editor changed"
            : "Project offer closed";
        const message = isSelectedPrimary
          ? `${authorization.session.displayName} assigned you as the primary editor. Offer acceptance was skipped and reply access is active now.`
          : isPreviousPrimary
            ? `${freelancer.displayName} is now the primary editor. You still have read-only project lane access.`
            : "Ops assigned this project directly to another editor, so your pending offer was closed.";
        const access = isSelectedPrimary ? "primary" : isPreviousPrimary ? "read_only" : "removed";

        if (!recipient.pushUserId) {
          return { editorId: recipient.editorId, attempted: 0, failed: 0, sent: 0, status: "no_login_user" as const };
        }

        await createAppNotification({
          userId: recipient.pushUserId,
          tenantId: conversation.tenantId,
          type: isSelectedPrimary ? "project_assigned_directly" : isPreviousPrimary ? "project_primary_changed" : "project_offer_withdrawn",
          title,
          message,
          entityType: "conversation",
          entityId: id,
          metadata: { conversationId: id, editorId: recipient.editorId, access },
        }).catch((error) => console.error("Failed to create direct-assignment notification", error));

        const push = await sendAssignmentStatusPushToUser({
          userId: recipient.pushUserId,
          payload: {
            assignmentId: pendingOffer?.id ?? id,
            conversationId: id,
            deepLinkUrl: `/chat?conversationId=${encodeURIComponent(id)}`,
            baseUrl: getRequestOrigin(request),
            title,
            body: message,
          },
        }).catch((error) => {
          console.error("Failed to dispatch direct-assignment status push", error);
          return { ok: false as const, attempted: 0, failed: 1, sent: 0, status: "dispatch_error" as const };
        });
        return { editorId: recipient.editorId, ...push };
      }),
    );

    console.info("Project editor assigned directly", {
      conversationId: id,
      editorId: freelancer.editorId,
      previousPrimaryId,
      pendingOffersWithdrawn: pendingOffers.length,
      pushSent: notificationTargets.reduce((total, target) => total + target.sent, 0),
    });

    return NextResponse.json({
      ok: true,
      assignmentMode: "direct",
      deduped: wasAlreadyPrimary && pendingOffers.length === 0,
      assignedFreelancerId: freelancer.editorId,
      assignedFreelancerName: freelancer.displayName,
      previousAssignedFreelancerId: previousPrimaryId,
      previousAssignedFreelancerName: previousPrimaryName,
      withdrawnOfferCount: pendingOffers.length,
      notificationDelivery: {
        targeted: notificationTargets.length,
        attempted: notificationTargets.reduce((total, target) => total + target.attempted, 0),
        sent: notificationTargets.reduce((total, target) => total + target.sent, 0),
        failed: notificationTargets.reduce((total, target) => total + target.failed, 0),
        targets: notificationTargets,
      },
      conversation: await getConversationViewForSession(authorization.session, id),
    });
  }

  if (requestedMode === "viewer") {
    const existingCollaboratorIds = new Set([
      currentConversationView.assignmentSummary?.assignedFreelancerId ?? "",
      ...(currentConversationView.assignmentSummary?.freelancerCollaborators ?? []).map((item) => item.freelancerId),
    ]);
    const addedFreelancers = matchedFreelancers.filter((item) => !existingCollaboratorIds.has(item.editorId));
    const updated = await addConversationFreelancerCollaboratorsFromFile(id, requestedFreelancerIds, assignedBy, {
      addedByName: authorization.session.displayName,
      freelancerNamesById: Object.fromEntries(
        matchedFreelancers.map((freelancer) => [freelancer.editorId, freelancer.displayName]),
      ),
    });
    if (!updated || "error" in updated) {
      return NextResponse.json(
        { ok: false, error: updated && "error" in updated ? updated.error : "Unable to add project viewers." },
        { status: 409 },
      );
    }

    const deliveryTargets = await Promise.all(
      addedFreelancers.map(async (freelancer) => {
        if (!freelancer.pushUserId) {
          return { editorId: freelancer.editorId, attempted: 0, failed: 0, sent: 0, status: "no_login_user" as const };
        }
        await createAppNotification({
          userId: freelancer.pushUserId,
          tenantId: updated.tenantId,
          type: "project_viewer_added",
          title: "Added to a project lane",
          message: "You can review this project chat. Only the primary editor can reply.",
          entityType: "conversation",
          entityId: id,
          metadata: { conversationId: id, editorId: freelancer.editorId, access: "read_only" },
        }).catch((error) => console.error("Failed to create collaborator notification", error));
        const push = await sendInboundMessagePushToUser({
          userId: freelancer.pushUserId,
          payload: {
            conversationId: id,
            deepLinkUrl: `/chat?conversationId=${encodeURIComponent(id)}`,
            baseUrl: getRequestOrigin(request),
            title: "Added to a project lane",
            body: "You have read-only access. Only the primary editor can reply.",
          },
        }).catch((error) => {
          console.error("Failed to dispatch collaborator push notification", error);
          return { ok: false as const, sent: 0 };
        });
        return {
          editorId: freelancer.editorId,
          attempted: 1,
          failed: push.sent > 0 ? 0 : 1,
          sent: push.sent,
          status: push.sent > 0 ? ("sent" as const) : ("failed" as const),
        };
      }),
    );
    const notificationDelivery = {
      targeted: deliveryTargets.length,
      attempted: deliveryTargets.reduce((total, target) => total + target.attempted, 0),
      sent: deliveryTargets.reduce((total, target) => total + target.sent, 0),
      failed: deliveryTargets.reduce((total, target) => total + target.failed, 0),
      targets: deliveryTargets,
    };
    console.info("Project lane viewers updated", {
      conversationId: id,
      requestedEditorCount: requestedFreelancerIds.length,
      addedViewerCount: addedFreelancers.length,
      pushSent: notificationDelivery.sent,
      pushFailed: notificationDelivery.failed,
    });
    return NextResponse.json({
      ok: true,
      assignmentMode: "viewer",
      deduped: addedFreelancers.length === 0,
      addedFreelancerIds: addedFreelancers.map((item) => item.editorId),
      notificationDelivery,
      conversation: await getConversationViewForSession(authorization.session, id),
    });
  }

  const conversation = await assignConversationFromFile(
    id,
    requestedFreelancerIds,
    assignedBy,
    matchedFreelancers[0]?.displayName,
    {
      projectDetails,
      offeredByName: authorization.session.displayName,
      freelancerNamesById: Object.fromEntries(
        matchedFreelancers.map((freelancer) => [freelancer.editorId, freelancer.displayName]),
      ),
      dispatchRequestId,
      intent: requestedMode === "replace" ? "replacement" : "primary",
    },
  );

  if (!conversation) {
    return NextResponse.json(
      { ok: false, error: "No eligible editor could receive this project offer right now." },
      { status: 409 },
    );
  }

  const conversationView = await getConversationViewForSession(authorization.session, id);
  const pendingOfferEditorIds = new Set(
    (conversation.assignmentOffers ?? [])
      .filter(
        (offer) =>
          offer.status === "PENDING" &&
          offer.dispatchRequestId === dispatchRequestId &&
          requestedFreelancerIds.includes(offer.freelancerId),
      )
      .map((offer) => offer.freelancerId),
  );
  const offeredFreelancers = matchedFreelancers.filter((freelancer) => pendingOfferEditorIds.has(freelancer.editorId));
  const deliveryTargets = await Promise.all(
    offeredFreelancers.map(async (freelancer) => {
      const offer = (conversation.assignmentOffers ?? []).find(
        (item) => item.dispatchRequestId === dispatchRequestId && item.freelancerId === freelancer.editorId,
      );
      if (!freelancer.pushUserId) {
        return { editorId: freelancer.editorId, pushUserId: null, attempted: 0, failed: 0, sent: 0, status: "no_login_user" as const };
      }

      await createAppNotification({
        userId: freelancer.pushUserId,
        tenantId: conversation.tenantId,
        type: "project_offer",
        title: requestedMode === "replace" ? "Primary editor replacement offer" : "New project offer",
        message:
          requestedMode === "replace"
            ? `${authorization.session.displayName} invited you to become the primary editor. Accept or reject within 10 minutes.`
            : `${authorization.session.displayName} sent project details. Open the app to accept or reject within 10 minutes.`,
        entityType: "conversation",
        entityId: id,
        metadata: { conversationId: id, editorId: freelancer.editorId },
      }).catch((error) => console.error("Failed to create assignment in-app notification", error));

      const push = await sendAssignmentPushToUser({
        userId: freelancer.pushUserId,
        payload: {
          assignmentId: id,
          conversationId: id,
          deepLinkUrl: `/chat?conversationId=${encodeURIComponent(id)}`,
          baseUrl: getRequestOrigin(request),
          expiresAt: offer?.expiresAt,
          title: requestedMode === "replace" ? "Primary editor replacement offer" : "New project offer",
          body:
            requestedMode === "replace"
              ? "Accept to become the primary editor. The current editor will move to read-only access."
              : `${authorization.session.displayName} sent project details. Open app to accept or reject.`,
        },
      }).catch((error) => {
        console.error("Failed to dispatch assignment push notification", error);
        return { ok: false as const, attempted: 0, failed: 1, sent: 0, status: "dispatch_error" as const };
      });
      return { editorId: freelancer.editorId, pushUserId: freelancer.pushUserId, ...push };
    }),
  );
  const notificationDelivery = {
    targeted: deliveryTargets.length,
    attempted: deliveryTargets.reduce((total, target) => total + target.attempted, 0),
    sent: deliveryTargets.reduce((total, target) => total + target.sent, 0),
    failed: deliveryTargets.reduce((total, target) => total + target.failed, 0),
    targets: deliveryTargets,
  };
  console.info("Project offer dispatch completed", {
    conversationId: id,
    requestedEditorCount: requestedFreelancerIds.length,
    createdOfferCount: offeredFreelancers.length,
    deduped: offeredFreelancers.length === 0,
    pushAttempted: notificationDelivery.attempted,
    pushSent: notificationDelivery.sent,
    pushFailed: notificationDelivery.failed,
  });

  return NextResponse.json({
    ok: true,
    assignmentMode: requestedMode === "replace" ? "replace" : "offer",
    deduped: offeredFreelancers.length === 0,
    offeredFreelancerIds: offeredFreelancers.map((freelancer) => freelancer.editorId),
    notificationDelivery,
    conversation: conversationView,
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const currentConversationView = await getConversationViewForSession(authorization.session, id);
  if (!currentConversationView) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const assignedBy = authorization.session.role === "MANAGER" ? "manager" : "admin";
  const pendingOffers = (currentConversationView.assignmentSummary?.offers ?? []).filter(
    (offer) => offer.status === "PENDING",
  );
  const removedFreelancerIds = Array.from(
    new Set(
      [
        currentConversationView.assignmentSummary?.assignedFreelancerId,
        ...(currentConversationView.assignmentSummary?.freelancerCollaborators ?? []).map((item) => item.freelancerId),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const hadEditorAccess = removedFreelancerIds.length > 0 || pendingOffers.length > 0;

  const conversation = await unassignConversationEditorsFromFile(id, assignedBy, {
    removedByName: authorization.session.displayName,
  });
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Unable to remove editor access from this project." }, { status: 409 });
  }

  const managedUsers = await getManagedAuthUsers();
  const affectedFreelancers = resolveFreelancerPushRecipients(
    Array.from(new Set([...removedFreelancerIds, ...pendingOffers.map((offer) => offer.freelancerId)])),
    managedUsers,
  );
  const withdrawnAt = new Date().toISOString();
  const notificationTargets = await Promise.all(
    affectedFreelancers.map(async (freelancer) => {
      if (!freelancer.pushUserId) {
        return { editorId: freelancer.editorId, attempted: 0, failed: 0, sent: 0, status: "no_login_user" as const };
      }

      const pendingOffer = pendingOffers.find((offer) => offer.freelancerId === freelancer.editorId);
      const wasPending = Boolean(pendingOffer);
      const title = wasPending ? "Project offer withdrawn" : "Removed from project lane";
      const message = wasPending
        ? "The agency returned this project to the unassigned queue."
        : "The agency set this project to No editor and removed your lane access.";

      await createAppNotification({
        userId: freelancer.pushUserId,
        tenantId: conversation.tenantId,
        type: wasPending ? "project_offer_withdrawn" : "project_assignment_removed",
        title,
        message,
        entityType: "conversation",
        entityId: id,
        metadata: { conversationId: id, editorId: freelancer.editorId },
      }).catch((error) => console.error("Failed to create offer withdrawal notification", error));

      const push = await sendAssignmentPushToUser({
        userId: freelancer.pushUserId,
        payload: {
          assignmentId: pendingOffer?.id ?? id,
          conversationId: id,
          deepLinkUrl: "/notifications",
          baseUrl: getRequestOrigin(request),
          eventType: "ASSIGNMENT_MISSED",
          expiresAt: withdrawnAt,
          title,
          body: message,
        },
      }).catch((error) => {
        console.error("Failed to dispatch offer withdrawal push", error);
        return { ok: false as const, attempted: 0, failed: 1, sent: 0, status: "dispatch_error" as const };
      });
      return { editorId: freelancer.editorId, ...push };
    }),
  );

  console.info("Project editor assignment removed", {
    conversationId: id,
    removedEditorCount: removedFreelancerIds.length,
    withdrawnOfferCount: pendingOffers.length,
    notificationPushSent: notificationTargets.reduce((total, target) => total + target.sent, 0),
  });

  return NextResponse.json({
    ok: true,
    deduped: !hadEditorAccess,
    removedFreelancerIds,
    withdrawnOfferCount: pendingOffers.length,
    notificationDelivery: {
      targeted: notificationTargets.length,
      attempted: notificationTargets.reduce((total, target) => total + target.attempted, 0),
      sent: notificationTargets.reduce((total, target) => total + target.sent, 0),
      failed: notificationTargets.reduce((total, target) => total + target.failed, 0),
      targets: notificationTargets,
    },
    conversation: await getConversationViewForSession(authorization.session, id),
  });
}
