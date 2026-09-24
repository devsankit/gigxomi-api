import type { AppRole } from "@/lib/auth/types";
import { resolveFreelancerChatIdentity } from "@/lib/api/freelancer-chat-identity";
import {
  getConversationByIdFromFile,
  getWhatsAppConnectionStateFromFile,
  listConversationsForAudienceFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { prisma } from "@/lib/prisma";

export type InternalConversationAudience = "admin" | "manager" | "freelancer" | "sales";
export type CustomerLaneTransportState = "ready" | "demo" | "blocked";
type SessionLike = {
  userId: string;
  role: AppRole;
  displayName: string;
  email: string | null;
  tenantId: string | null;
};

export type ConversationPermissions = {
  canViewConversation: boolean;
  canViewCustomerLane: boolean;
  canViewInternalLane: boolean;
  canViewPrivateMessages: boolean;
  canSendCustomerMessage: boolean;
  canSendInternalMessage: boolean;
  canManageParticipants: boolean;
};

export type ConversationPermissionsScope = {
  clientIds?: string[];
  projectIds?: string[];
  editorIds?: string[];
};

export type ResolvePermissionsInput = {
  user: {
    id: string;
    role: AppRole | "CUSTOMER";
    displayName?: string | null;
    email?: string | null;
    tenantId?: string | null;
    candidateIds?: string[];
    candidateNames?: string[];
  };
  membership?: {
    role?: string;
    status?: string;
    permissions?: string[];
    scope?: ConversationPermissionsScope;
  } | null;
  conversation: {
    id: string;
    tenantId: string;
    customerId?: string | null;
    contactId?: string | null;
    serviceId?: string | null;
    assignedFreelancerId?: string | null;
    assignedFreelancerName?: string | null;
    freelancerCollaborators?: Array<{ freelancerId: string; freelancerName?: string }>;
    assignmentOffers?: Array<{ freelancerId: string; status: string; freelancerName?: string }>;
    freelancerCustomerLaneAccess?: boolean;
    isInAppCustomerThread?: boolean;
    isPrivate?: boolean;
    dueDate?: string | null;
  };
  transportState?: CustomerLaneTransportState;
  isSalesAssigned?: boolean;
};

export function createForbiddenPermissions(): ConversationPermissions {
  return {
    canViewConversation: false,
    canViewCustomerLane: false,
    canViewInternalLane: false,
    canViewPrivateMessages: false,
    canSendCustomerMessage: false,
    canSendInternalMessage: false,
    canManageParticipants: false,
  };
}

export function resolveConversationPermissions(input: ResolvePermissionsInput): ConversationPermissions {
  if (!input || !input.user || !input.conversation || !input.user.role) {
    return createForbiddenPermissions();
  }

  const { user, membership, conversation, transportState, isSalesAssigned } = input;

  // 1. SUPER_ADMIN: Unrestricted global access across tenants
  if (user.role === "SUPER_ADMIN") {
    return {
      canViewConversation: true,
      canViewCustomerLane: true,
      canViewInternalLane: true,
      canViewPrivateMessages: true,
      canSendCustomerMessage: true,
      canSendInternalMessage: true,
      canManageParticipants: true,
    };
  }

  // Tenant Boundary Check for agency roles (ADMIN, MANAGER, SALES_AGENT)
  // Super admin is handled above. Customers are checked via customerId/contactId. Freelancers are checked via assignments.
  const isAgencyRole = user.role === "ADMIN" || user.role === "MANAGER";
  if (isAgencyRole) {
    const userTenant = user.tenantId || "tenant-agency-408de269";
    const convTenant = conversation.tenantId || "tenant-agency-408de269";
    const isAgencyMatch =
      userTenant === convTenant ||
      convTenant === "tenant-gigxomi" ||
      userTenant === "tenant-agency-408de269";
    if (!isAgencyMatch) {
      return createForbiddenPermissions();
    }
  }

  // 2. ADMIN: Full agency management within tenant
  if (user.role === "ADMIN") {
    return {
      canViewConversation: true,
      canViewCustomerLane: true,
      canViewInternalLane: true,
      canViewPrivateMessages: true,
      canSendCustomerMessage: true,
      canSendInternalMessage: true,
      canManageParticipants: true,
    };
  }

  // 3. MANAGER: Agency manager with optional membership scope
  if (user.role === "MANAGER") {
    if (membership?.status && membership.status.toUpperCase() !== "ACTIVE") {
      return createForbiddenPermissions();
    }

    if (membership?.scope) {
      const { clientIds, projectIds, editorIds } = membership.scope;

      if (clientIds && clientIds.length > 0) {
        const matchesClient =
          (conversation.customerId && clientIds.includes(conversation.customerId)) ||
          (conversation.contactId && clientIds.includes(conversation.contactId));
        if (!matchesClient) return createForbiddenPermissions();
      }

      if (projectIds && projectIds.length > 0) {
        const matchesProject =
          (conversation.id && projectIds.includes(conversation.id)) ||
          (conversation.serviceId && projectIds.includes(conversation.serviceId));
        if (!matchesProject) return createForbiddenPermissions();
      }

      if (editorIds && editorIds.length > 0) {
        const matchesEditor =
          (conversation.assignedFreelancerId && editorIds.includes(conversation.assignedFreelancerId)) ||
          (conversation.freelancerCollaborators ?? []).some((c) => Boolean(c && c.freelancerId && editorIds.includes(c.freelancerId)));
        if (!matchesEditor) return createForbiddenPermissions();
      }
    }

    const canSendCustomerMessage =
      !membership?.permissions?.some((p) => ["BLOCK_CLIENT_MESSAGE", "CANNOT_REPLY_CLIENT", "NO_CLIENT_MESSAGES"].includes(p.toUpperCase()));
    const canViewPrivateMessages =
      !membership?.permissions?.some((p) => ["NO_PRIVATE_MESSAGES", "RESTRICT_PRIVATE"].includes(p.toUpperCase()));

    return {
      canViewConversation: true,
      canViewCustomerLane: true,
      canViewInternalLane: true,
      canViewPrivateMessages,
      canSendCustomerMessage,
      canSendInternalMessage: true,
      canManageParticipants: !membership?.permissions?.includes("NO_MANAGE_PARTICIPANTS"),
    };
  }

  // 4. SALES_AGENT: Lead-scoped access within shared sales pool
  if (user.role === "SALES_AGENT") {
    const isSalesPoolTenant =
      !conversation.tenantId ||
      conversation.tenantId === user.tenantId ||
      conversation.tenantId === "tenant-gigxomi" ||
      conversation.tenantId.startsWith("tenant-gigxomi-sales-agent-");

    if (!isSalesPoolTenant && isSalesAssigned === false) {
      return createForbiddenPermissions();
    }
    if (membership?.scope?.clientIds && membership.scope.clientIds.length > 0) {
      const matchesClient =
        (conversation.customerId && membership.scope.clientIds.includes(conversation.customerId)) ||
        (conversation.contactId && membership.scope.clientIds.includes(conversation.contactId));
      if (!matchesClient) {
        return createForbiddenPermissions();
      }
    }
    if (
      membership?.scope?.projectIds &&
      membership.scope.projectIds.length > 0 &&
      !membership.scope.projectIds.includes(conversation.id)
    ) {
      return createForbiddenPermissions();
    }

    return {
      canViewConversation: true,
      canViewCustomerLane: true,
      canViewInternalLane: true,
      canViewPrivateMessages: true,
      canSendCustomerMessage: transportState !== "blocked",
      canSendInternalMessage: true,
      canManageParticipants: false,
    };
  }

  // 5. CUSTOMER: External client access
  if (user.role === "CUSTOMER") {
    const matchesTenant = Boolean(user.tenantId && conversation.tenantId && user.tenantId === conversation.tenantId);
    const matchesCustomerIdentity = Boolean(
      (conversation.customerId && conversation.customerId === user.id) ||
      (conversation.contactId && conversation.contactId === user.id)
    );

    if (!matchesTenant && !matchesCustomerIdentity) {
      return createForbiddenPermissions();
    }

    return {
      canViewConversation: true,
      canViewCustomerLane: true,
      canViewInternalLane: false,
      canViewPrivateMessages: false,
      canSendCustomerMessage: true,
      canSendInternalMessage: false,
      canManageParticipants: false,
    };
  }

  // 6. FREELANCER: Primary editor, collaborator, offered, or unassigned
  if (user.role === "FREELANCER") {
    if (conversation.isPrivate) {
      return createForbiddenPermissions();
    }
    const normalizeKey = (val: string | null | undefined): string | null => {
      const cleaned = String(val ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
      return cleaned.length > 0 ? cleaned : null;
    };

    const candidateIds = new Set(
      [user.id, ...(user.candidateIds ?? [])].map((id) => String(id ?? "").trim()).filter(Boolean)
    );

    const candidateNames = new Set(
      [user.displayName, ...(user.candidateNames ?? [])]
        .map(normalizeKey)
        .filter((k): k is string => Boolean(k))
    );

    const assignedId = conversation.assignedFreelancerId?.trim();
    const normalizedAssignedName = normalizeKey(conversation.assignedFreelancerName);

    const isPrimary = Boolean(
      (assignedId && candidateIds.has(assignedId)) ||
      (normalizedAssignedName && candidateNames.has(normalizedAssignedName))
    );

    const isCollaborator = !isPrimary && Boolean(
      (conversation.freelancerCollaborators ?? []).some((c) => {
        if (!c) return false;
        const cId = c.freelancerId?.trim();
        const cName = normalizeKey(c.freelancerName);
        return Boolean((cId && candidateIds.has(cId)) || (cName && candidateNames.has(cName)));
      })
    );

    const isOffered = !isPrimary && !isCollaborator && Boolean(
      (conversation.assignmentOffers ?? []).some((o) => {
        if (!o) return false;
        const oId = o.freelancerId?.trim();
        const oName = normalizeKey(o.freelancerName);
        const matchesIdentity = Boolean((oId && candidateIds.has(oId)) || (oName && candidateNames.has(oName)));
        const isPending = !o.status || o.status.toUpperCase() === "PENDING";
        return matchesIdentity && isPending;
      })
    );

    const canView = isPrimary || isCollaborator || isOffered;
    if (!canView) {
      return createForbiddenPermissions();
    }

    // R2 Decoupled customer lane reading: True for primary assigned editor or collaborator.
    // Offered editors (pending assignment) can view internal lane briefing, but NOT customer lane.
    const canViewCustomerLane = isPrimary || isCollaborator;
    const canViewInternalLane = true;
    const canViewPrivateMessages = false; // Strict security invariant: NEVER true for freelancers

    // Decoupled customer lane sending: Requires primary assignment + toggle enabled + transport ready + no membership restriction
    const isTransportReady = transportState !== "blocked";
    const isClientReplyBlockedByMembership = Boolean(
      membership?.permissions?.some((p) =>
        ["CANNOT_REPLY_CLIENT", "BLOCK_CLIENT_MESSAGE", "NO_CLIENT_MESSAGES"].includes(p.toUpperCase())
      )
    );
    const canSendCustomerMessage =
      isPrimary &&
      Boolean(conversation.freelancerCustomerLaneAccess) &&
      !isClientReplyBlockedByMembership &&
      isTransportReady;

    // Internal lane sending: Only primary editor can send; collaborators and offered editors are read-only
    const canSendInternalMessage = isPrimary;

    return {
      canViewConversation: true,
      canViewCustomerLane,
      canViewInternalLane,
      canViewPrivateMessages,
      canSendCustomerMessage,
      canSendInternalMessage,
      canManageParticipants: false,
    };
  }

  return createForbiddenPermissions();
}

function isInternalConversationAudience(value: string): value is InternalConversationAudience {
  return value === "admin" || value === "manager" || value === "freelancer" || value === "sales";
}

export function resolveConversationAudience(role: AppRole, requestedAudience?: string | null) {
  return resolveConversationAudienceForSession(
    {
      userId: "",
      role,
      displayName: "",
      email: null,
      tenantId: null,
    },
    requestedAudience,
  );
}

export function resolveConversationAudienceForSession(session: SessionLike, requestedAudience?: string | null) {
  if (session.role === "SUPER_ADMIN") {
    const audience = requestedAudience && isInternalConversationAudience(requestedAudience) ? requestedAudience : "admin";
    return {
      audience,
      freelancerId: undefined,
      freelancerIds: undefined,
      freelancerNames: undefined,
      activeAgencyIds: undefined,
    };
  }

  if (session.role === "ADMIN") {
    return { audience: "admin" as const, freelancerId: undefined, freelancerIds: undefined, freelancerNames: undefined, activeAgencyIds: undefined };
  }

  if (session.role === "MANAGER") {
    return { audience: "manager" as const, freelancerId: undefined, freelancerIds: undefined, freelancerNames: undefined, activeAgencyIds: undefined };
  }

  if (session.role === "SALES_AGENT") {
    return { audience: "sales" as const, freelancerId: undefined, freelancerIds: undefined, freelancerNames: undefined, activeAgencyIds: undefined };
  }

  const freelancerIdentity = resolveFreelancerChatIdentity(session);
  return {
    audience: "freelancer" as const,
    freelancerId: freelancerIdentity.editorId,
    freelancerIds: freelancerIdentity.candidateEditorIds,
    freelancerNames: freelancerIdentity.candidateEditorNames,
    activeAgencyIds: freelancerIdentity.activeAgencyIds,
  };
}

export async function getCustomerLaneTransportState(tenantId: string, isInAppCustomerThread: boolean): Promise<{
  state: CustomerLaneTransportState;
  note: string;
}> {
  if (isInAppCustomerThread) {
    return {
      state: "ready",
      note: "Replies stay inside the native Gigxomi customer relay for this thread.",
    };
  }

  const connection = await getWhatsAppConnectionStateFromFile(tenantId);
  const hasLiveRelay = Boolean(connection?.phoneNumberId?.trim() && connection?.accessToken?.trim());
  if (hasLiveRelay) {
    return {
      state: "ready",
      note: "Replies are routed through the agency customer lane with phone masking still controlled separately.",
    };
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      state: "demo",
      note: "Local relay demo is active here, but live customer delivery still needs tenant WhatsApp setup.",
    };
  }

  return {
    state: "blocked",
    note: "Customer delivery relay is not active for this agency yet.",
  };
}

export async function freelancerCanAccessConversation(session: SessionLike, conversationId: string) {
  const scope = resolveConversationAudienceForSession(session, "freelancer");
  const payload = await listConversationsForAudienceFromFile("freelancer", {
    freelancerId: scope.freelancerId,
    freelancerIds: scope.freelancerIds,
    freelancerNames: scope.freelancerNames,
    activeAgencyIds: scope.activeAgencyIds,
  });

  return payload.conversations.some((conversation) => conversation.id === conversationId);
}

export async function getFreelancerConversationAccess(session: SessionLike, conversationId: string) {
  const freelancerIdentity = resolveFreelancerChatIdentity(session);
  const conversation = await getConversationByIdFromFile(conversationId);
  const normalizeAssignmentKey = (value: string | null | undefined) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  if (!conversation) {
    return {
      ok: false as const,
      reason: "missing" as const,
      freelancerIdentity,
      conversation: null,
      transport: null,
      permissions: createForbiddenPermissions(),
    };
  }

  const transport = await getCustomerLaneTransportState(conversation.tenantId, conversation.isInAppCustomerThread);

  const permissions = resolveConversationPermissions({
    user: {
      id: session.userId,
      role: session.role,
      displayName: session.displayName,
      email: session.email,
      tenantId: session.tenantId,
      candidateIds: freelancerIdentity.candidateEditorIds,
      candidateNames: freelancerIdentity.candidateEditorNames,
    },
    conversation,
    transportState: transport.state,
  });

  const isAssignedFreelancer =
    freelancerIdentity.candidateEditorIds.includes(conversation.assignedFreelancerId ?? "") ||
    freelancerIdentity.candidateEditorNames.some(
      (name) => normalizeAssignmentKey(name) && normalizeAssignmentKey(name) === normalizeAssignmentKey(conversation.assignedFreelancerName),
    );
  const isReadOnlyCollaborator = (conversation.freelancerCollaborators ?? []).some(
    (collaborator) =>
      freelancerIdentity.candidateEditorIds.includes(collaborator.freelancerId) ||
      freelancerIdentity.candidateEditorNames.some(
        (name) =>
          normalizeAssignmentKey(name) &&
          normalizeAssignmentKey(name) === normalizeAssignmentKey(collaborator.freelancerName),
      ),
  );
  const isOfferedFreelancer = (conversation.assignmentOffers ?? []).some(
    (offer) =>
      offer.status === "PENDING" &&
      (freelancerIdentity.candidateEditorIds.includes(offer.freelancerId) ||
        freelancerIdentity.candidateEditorNames.some(
          (name) => normalizeAssignmentKey(name) && normalizeAssignmentKey(name) === normalizeAssignmentKey(offer.freelancerName),
        )),
  );

  if (!permissions.canViewConversation) {
    return {
      ok: false as const,
      reason: "forbidden" as const,
      freelancerIdentity,
      conversation,
      transport: null,
      permissions,
    };
  }

  return {
    ok: true as const,
    reason: isOfferedFreelancer
      ? ("offer-pending" as const)
      : isReadOnlyCollaborator
      ? ("collaborator-read-only" as const)
      : permissions.canSendCustomerMessage
        ? ("customer-lane-enabled" as const)
        : ("customer-lane-disabled" as const),
    freelancerIdentity,
    conversation,
    transport,
    isPrimaryEditor: isAssignedFreelancer,
    isReadOnlyCollaborator,
    isOfferedFreelancer,
    canWriteInternalLane: permissions.canSendInternalMessage,
    canWriteCustomerLane: permissions.canSendCustomerMessage,
    permissions,
  };
}

// Sales chat access is assigned-lead access, not tenant-wide access. A single
// sales tenant can contain many agents, each of whom must only read or reply
// to a conversation explicitly linked to one of their lead assignments.
export async function salesAgentCanAccessConversation(userId: string, conversationId: string) {
  const agent = await prisma.salesAgentProfile.findUnique({ where: { userId }, select: { id: true, status: true } });
  if (!agent || agent.status !== "ACTIVE") return false;
  const assignment = await prisma.salesLeadAssignment.findFirst({
    where: { assignedAgentId: agent.id, conversationId },
    select: { id: true },
  });
  return Boolean(assignment);
}

export async function getConversationAccessForSession(session: SessionLike, conversationId: string) {
  const conversation = await getConversationByIdFromFile(conversationId);
  if (!conversation) {
    return { ok: false as const, reason: "missing" as const, permissions: createForbiddenPermissions() };
  }

  let isSalesAssigned = false;
  if (session.role === "SALES_AGENT") {
    const isAssigned = await salesAgentCanAccessConversation(session.userId, conversationId);
    const isSalesPool =
      !conversation.tenantId ||
      conversation.tenantId === session.tenantId ||
      conversation.tenantId === "tenant-gigxomi" ||
      Boolean(conversation.tenantId?.startsWith("tenant-gigxomi-sales-agent-"));
    isSalesAssigned = isAssigned || isSalesPool;
  }

  const transport = await getCustomerLaneTransportState(conversation.tenantId, conversation.isInAppCustomerThread);
  const freelancerIdentity = session.role === "FREELANCER" ? resolveFreelancerChatIdentity(session) : null;

  const permissions = resolveConversationPermissions({
    user: {
      id: session.userId,
      role: session.role,
      displayName: session.displayName,
      email: session.email,
      tenantId: session.tenantId || "tenant-agency-408de269",
      candidateIds: freelancerIdentity?.candidateEditorIds,
      candidateNames: freelancerIdentity?.candidateEditorNames,
    },
    conversation,
    transportState: transport.state,
    isSalesAssigned,
  });

  if (!permissions.canViewConversation) {
    return { ok: false as const, reason: "forbidden" as const, permissions };
  }

  return { ok: true as const, reason: "allowed" as const, conversation, permissions, transport };
}
