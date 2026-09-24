export type ChatPushAudience = "admin" | "manager" | "freelancer";

export type ChatPushRecipientCandidate = {
  activeAgencyIds: string[];
  assignedRole: string;
  displayName: string;
  email: string | null;
  freelancerIdentityIds: string[];
  freelancerIdentityNames: string[];
  id: string;
  packageAudience: string | null;
  role: string;
  tenantId: string | null;
  workspaceMode: string | null;
};

export type ChatPushConversation = {
  assignedFreelancerId?: string | null;
  assignedFreelancerName?: string | null;
  freelancerCustomerLaneAccess?: boolean;
  ownerName?: string | null;
  ownerRole?: "manager" | "admin" | null;
  tenantId: string;
};

export type ChatPushMessage = {
  lane: "customer" | "internal";
  senderRole: string;
  visibility?: string | null;
};

export type ChatPushSkipReason =
  | "freelancer_ambiguous"
  | "freelancer_not_assigned"
  | "freelancer_not_found"
  | "lane_not_allowed"
  | "owner_ambiguous"
  | "owner_not_found"
  | "sender_not_supported";

export type ResolvedChatPushRecipient = {
  audience: ChatPushAudience;
  user: ChatPushRecipientCandidate;
};

export type ChatPushRecipientResolution = {
  recipients: ResolvedChatPushRecipient[];
  skipped: ChatPushSkipReason[];
};

export function resolveChatPushMessage<TMessage extends { createdAt?: string | null; id: string }>(
  messages: readonly TMessage[],
  messageId?: string | null,
) {
  const exactMessageId = messageId?.trim();
  if (exactMessageId) {
    return messages.find((message) => message.id === exactMessageId) ?? null;
  }

  return messages.reduce<TMessage | null>((latest, message) => {
    if (!latest) return message;
    const latestTime = new Date(latest.createdAt ?? "").getTime();
    const messageTime = new Date(message.createdAt ?? "").getTime();
    return (Number.isFinite(messageTime) ? messageTime : 0) > (Number.isFinite(latestTime) ? latestTime : 0)
      ? message
      : latest;
  }, null);
}

function normalizeIdentity(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function hasRole(candidate: ChatPushRecipientCandidate, role: "ADMIN" | "MANAGER" | "FREELANCER") {
  return candidate.role === role || candidate.assignedRole === role;
}

function isFreelancerAccount(candidate: ChatPushRecipientCandidate) {
  if (candidate.packageAudience === "AGENCY" || candidate.workspaceMode === "AGENCY") return false;
  return hasRole(candidate, "FREELANCER") || candidate.packageAudience === "FREELANCER" || candidate.workspaceMode === "FREELANCER";
}

function isAgencyAccount(candidate: ChatPushRecipientCandidate) {
  if (candidate.packageAudience === "FREELANCER" || candidate.workspaceMode === "FREELANCER") return false;
  return hasRole(candidate, "ADMIN") || hasRole(candidate, "MANAGER");
}

function isPrimaryAgencyAdmin(candidate: ChatPushRecipientCandidate) {
  return (
    hasRole(candidate, "ADMIN") &&
    (candidate.packageAudience === "AGENCY" || candidate.workspaceMode === "AGENCY")
  );
}

function audienceForAgency(candidate: ChatPushRecipientCandidate): "admin" | "manager" {
  return hasRole(candidate, "MANAGER") ? "manager" : "admin";
}

function resolveAgencyOwner(
  candidates: ChatPushRecipientCandidate[],
  conversation: ChatPushConversation,
): { recipient: ResolvedChatPushRecipient | null; reason?: "owner_ambiguous" | "owner_not_found" } {
  const agencyCandidates = candidates.filter(
    (candidate) => candidate.tenantId === conversation.tenantId && isAgencyAccount(candidate),
  );
  const ownerName = normalizeIdentity(conversation.ownerName);
  const expectedRole = conversation.ownerRole === "manager" ? "MANAGER" : conversation.ownerRole === "admin" ? "ADMIN" : null;
  const explicitMatches = ownerName
    ? agencyCandidates.filter((candidate) => {
        const roleMatches = !expectedRole || hasRole(candidate, expectedRole);
        return roleMatches && normalizeIdentity(candidate.displayName) === ownerName;
      })
    : [];

  if (explicitMatches.length === 1) {
    return {
      recipient: {
        audience: audienceForAgency(explicitMatches[0]),
        user: explicitMatches[0],
      },
    };
  }
  if (explicitMatches.length > 1) {
    return { recipient: null, reason: "owner_ambiguous" };
  }

  const primaryAdmins = agencyCandidates.filter(isPrimaryAgencyAdmin);
  if (primaryAdmins.length === 1) {
    return {
      recipient: {
        audience: "admin",
        user: primaryAdmins[0],
      },
    };
  }
  return {
    recipient: null,
    reason: primaryAdmins.length > 1 ? "owner_ambiguous" : "owner_not_found",
  };
}

function resolveAssignedFreelancer(
  candidates: ChatPushRecipientCandidate[],
  conversation: ChatPushConversation,
): { recipient: ResolvedChatPushRecipient | null; reason?: "freelancer_ambiguous" | "freelancer_not_assigned" | "freelancer_not_found" } {
  const assignedId = conversation.assignedFreelancerId?.trim();
  if (!assignedId) {
    return { recipient: null, reason: "freelancer_not_assigned" };
  }

  const assignedNames = new Set(
    [conversation.assignedFreelancerName]
      .map(normalizeIdentity)
      .filter(Boolean),
  );
  const matches = candidates.filter((candidate) => {
    if (!isFreelancerAccount(candidate) || !candidate.activeAgencyIds.includes(conversation.tenantId)) return false;
    if (candidate.freelancerIdentityIds.includes(assignedId)) return true;
    return candidate.freelancerIdentityNames
      .map(normalizeIdentity)
      .some((identity) => identity && assignedNames.has(identity));
  });

  if (matches.length === 1) {
    return {
      recipient: {
        audience: "freelancer",
        user: matches[0],
      },
    };
  }
  return {
    recipient: null,
    reason: matches.length > 1 ? "freelancer_ambiguous" : "freelancer_not_found",
  };
}

function addRecipient(recipients: Map<string, ResolvedChatPushRecipient>, recipient: ResolvedChatPushRecipient | null) {
  if (recipient) recipients.set(recipient.user.id, recipient);
}

export function resolveChatPushRecipients(input: {
  candidates: ChatPushRecipientCandidate[];
  conversation: ChatPushConversation;
  message: ChatPushMessage;
  senderId?: string | null;
  senderRole?: string | null;
}): ChatPushRecipientResolution {
  const candidates = input.candidates.filter((candidate) => !input.senderId || candidate.id !== input.senderId);
  const recipients = new Map<string, ResolvedChatPushRecipient>();
  const skipped = new Set<ChatPushSkipReason>();
  const senderRole = String(input.senderRole || input.message.senderRole || "").trim().toLowerCase();
  const isCustomerSender = senderRole === "customer" || Boolean(input.senderId?.startsWith("external-"));

  const isPrivate = String(input.message.visibility ?? "").trim().toLowerCase() === "client_private";

  if (isCustomerSender) {
    const owner = resolveAgencyOwner(candidates, input.conversation);
    addRecipient(recipients, owner.recipient);
    if (owner.reason) skipped.add(owner.reason);

    if (input.message.lane !== "customer" || !input.conversation.freelancerCustomerLaneAccess || isPrivate) {
      skipped.add("lane_not_allowed");
    } else {
      const freelancer = resolveAssignedFreelancer(candidates, input.conversation);
      addRecipient(recipients, freelancer.recipient);
      if (freelancer.reason) skipped.add(freelancer.reason);
    }
  } else if (senderRole === "freelancer") {
    if (input.message.lane !== "internal") {
      skipped.add("lane_not_allowed");
    } else {
      const owner = resolveAgencyOwner(candidates, input.conversation);
      addRecipient(recipients, owner.recipient);
      if (owner.reason) skipped.add(owner.reason);
    }
  } else if (senderRole === "admin" || senderRole === "manager") {
    if (input.message.lane !== "internal" || isPrivate) {
      skipped.add("lane_not_allowed");
    } else {
      const freelancer = resolveAssignedFreelancer(candidates, input.conversation);
      addRecipient(recipients, freelancer.recipient);
      if (freelancer.reason) skipped.add(freelancer.reason);
    }
  } else {
    skipped.add("sender_not_supported");
  }

  return {
    recipients: [...recipients.values()],
    skipped: [...skipped],
  };
}
