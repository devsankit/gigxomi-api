import type { AppRole } from "@/lib/auth/types";
import { projectConversation, type DummyConversationView } from "@/lib/gigxomi/dummy-platform-store";
import { getConversationByIdFromFile, listConversationsForAudienceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

import { resolveConversationAudienceForSession, salesAgentCanAccessConversation } from "@/lib/api/conversation-access";

type ConversationSessionLike = {
  userId: string;
  role: AppRole;
  displayName: string;
  email: string | null;
  tenantId: string | null;
};

export async function getConversationViewForSession(
  session: ConversationSessionLike,
  conversationId: string,
  requestedAudience?: string | null,
): Promise<DummyConversationView | null> {
  const scope = resolveConversationAudienceForSession(session, requestedAudience);
  if (session.role === "SALES_AGENT") {
    const conversation = await getConversationByIdFromFile(conversationId);
    if (!conversation) return null;
    const isAssigned = await salesAgentCanAccessConversation(session.userId, conversationId);
    const isSalesPool =
      !conversation.tenantId ||
      conversation.tenantId === session.tenantId ||
      conversation.tenantId === "tenant-gigxomi" ||
      Boolean(conversation.tenantId?.startsWith("tenant-gigxomi-sales-agent-"));
    if (!isAssigned && !isSalesPool) return null;
    return projectConversation(conversation, "sales");
  }
  const tenantId =
    session.role === "SUPER_ADMIN"
      ? undefined
      : session.tenantId?.trim();
  if ((scope.audience === "admin" || scope.audience === "manager") && session.role !== "SUPER_ADMIN" && !tenantId) {
    return null;
  }
  const conversation = await getConversationByIdFromFile(conversationId);
  if (!conversation) {
    return null;
  }

  if (scope.audience === "admin" || scope.audience === "manager") {
    if (tenantId && conversation.tenantId !== tenantId) {
      return null;
    }
  } else if (scope.audience === "freelancer") {
    if (conversation.isPrivate) {
      return null;
    }
    const freelancerIds = scope.freelancerIds ?? [];
    const freelancerNames = (scope.freelancerNames ?? []).map((n) => n.trim().toLowerCase());
    const isAssigned =
      freelancerIds.includes(conversation.assignedFreelancerId ?? "") ||
      freelancerNames.includes(String(conversation.assignedFreelancerName ?? "").trim().toLowerCase());
    const isCollaborator = (conversation.freelancerCollaborators ?? []).some(
      (c) => freelancerIds.includes(c.freelancerId) || freelancerNames.includes(String(c.freelancerName ?? "").trim().toLowerCase()),
    );
    const isOffered = (conversation.assignmentOffers ?? []).some(
      (o) => freelancerIds.includes(o.freelancerId) || freelancerNames.includes(String(o.freelancerName ?? "").trim().toLowerCase()),
    );

    if (!isAssigned && !isCollaborator && !isOffered) {
      return null;
    }
  }

  return projectConversation(conversation, scope.audience, {
    freelancerAliasKeys: scope.freelancerIds,
    freelancerNames: scope.freelancerNames,
    userId: session.userId,
    userName: session.displayName,
    lightweight: false,
  });
}
