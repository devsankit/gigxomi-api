import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import type { SessionUser } from "@/lib/auth/types";
import { getEffectiveBillingPackageForUser } from "@/lib/billing/billing-access-service";
import { buildAdminDashboardSnapshot } from "@/lib/gigxomi/dashboard-overview-data";
import {
  getInstagramConnectionStateFromFile,
  getWhatsAppConnectionStateFromFile,
  listConversationsForAudienceFromFile,
  listLeadStatusesFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import {
  DummyInstagramConnectionState,
  DummyWhatsAppConnectionState,
} from "@/lib/gigxomi/dummy-platform-store";
import { getAgencyListingByTenantIdFromFile } from "@/lib/gigxomi/agency-listing-store";
import { prisma } from "@/lib/prisma";

const DEFAULT_TENANT_ID = "tenant-agency-408de269";

type ConnectedChannelStatus = "connected" | "needs_attention" | "not_connected";

type ConnectedChannelView = {
  label: string;
  value: string;
  detail: string;
  status: ConnectedChannelStatus;
  statusLabel: string;
};

function resolveConnectionTenantId(session: Pick<SessionUser, "role" | "tenantId">) {
  const tenantId = session.tenantId?.trim();
  if (tenantId && tenantId !== "tenant-gigxomi") {
    return tenantId;
  }

  return DEFAULT_TENANT_ID;
}

function compactText(parts: string[]) {
  return parts.map((part) => part.trim()).filter(Boolean).join(" - ");
}

function buildWhatsAppChannel(connection: DummyWhatsAppConnectionState | null): ConnectedChannelView {
  const number = connection?.phoneNumber?.trim() ?? "";
  const phoneNumberId = connection?.phoneNumberId?.trim() ?? "";
  const displayName = connection?.displayName?.trim() ?? "";
  const connectedDetail = compactText([displayName, phoneNumberId ? `Phone ID ${phoneNumberId}` : ""]);
  const hasMetaCredentials = Boolean(connection?.phoneNumberId?.trim() && (connection?.accessToken?.trim() || connection?.status === "Ready for webhook"));
  const isConnected = Boolean(connection?.pluginEnabled) && hasMetaCredentials;
  const hasDraftPhone = Boolean(number);
  const needsAttention = Boolean(connection?.pluginEnabled) && !isConnected && Boolean(connection?.lastError?.trim() || hasDraftPhone || connection?.status !== "Not started");

  return {
    label: "WhatsApp phone number",
    value: number || (phoneNumberId ? `ID ${phoneNumberId}` : "Not connected yet"),
    detail: isConnected
      ? connectedDetail || "WhatsApp Business line is live and connected."
      : hasDraftPhone
        ? "Phone number saved. Complete Meta Cloud API connection in Integrations to receive client chats."
        : connection?.lastError?.trim() || connection?.note?.trim() || "Connect your WhatsApp Business number from Integrations.",
    status: isConnected ? "connected" : needsAttention ? "needs_attention" : "not_connected",
    statusLabel: isConnected ? "Connected" : hasDraftPhone ? "Meta Setup Pending" : connection?.pluginEnabled ? connection.status : "Not connected",
  };
}

function buildInstagramChannel(connection: DummyInstagramConnectionState | null): ConnectedChannelView {
  const username = connection?.username?.trim().replace(/^@/, "") ?? "";
  const accountId = connection?.accountId?.trim() ?? "";
  const accountType = connection?.accountType?.trim() ?? "";
  const connectedDetail = compactText([accountId ? `Account ID ${accountId}` : "", accountType]);
  const hasMetaCredentials = Boolean(accountId && connection?.accessToken?.trim());
  const isConnected = Boolean(connection?.pluginEnabled) && hasMetaCredentials && connection?.status === "Connected";
  const hasDraftUsername = Boolean(username);
  const needsAttention = Boolean(connection?.pluginEnabled) && !isConnected && (Boolean(connection?.lastError?.trim()) || hasDraftUsername || connection?.status === "Needs attention");

  return {
    label: "Instagram ID",
    value: username ? `@${username}` : accountId ? `ID ${accountId}` : "Not connected yet",
    detail: isConnected
      ? connectedDetail || "Instagram business account is live and connected."
      : hasDraftUsername
        ? "Instagram handle saved. Complete Meta OAuth in Integrations to enable Direct chats."
        : connection?.lastError?.trim() || "Connect the Instagram business account from the Meta setup.",
    status: isConnected ? "connected" : needsAttention ? "needs_attention" : "not_connected",
    statusLabel: isConnected ? "Connected" : hasDraftUsername ? "Meta Setup Pending" : connection?.pluginEnabled ? connection.status : "Not connected",
  };
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const tenantId = resolveConnectionTenantId(authorization.session);
  const now = new Date();

  // If user is a MANAGER, find the agency's primary ADMIN user ID for billing & onboarding queries
  const adminUser = tenantId
    ? await prisma.appAuthUser.findFirst({
        where: { tenantId, role: "ADMIN" },
        select: { id: true, displayName: true },
      }).catch(() => null)
    : null;

  const effectiveAdminUserId =
    authorization.session.role === "ADMIN"
      ? authorization.session.userId
      : (adminUser?.id || authorization.session.userId);

  const [
    snapshot,
    whatsappConnection,
    instagramConnection,
    dbTotalChats,
    dbUnassignedChats,
    dbAssignedChats,
    dbActiveMembers,
    dbAssignments,
    obState,
    authUser,
    dbQualifiedChats,
    dbPaymentRequests,
    dbAllConversations,
    liveLeadStatuses,
    liveConvsPayload,
    agencyListing,
  ] = await Promise.all([
    buildAdminDashboardSnapshot(authorization.session),
    tenantId ? getWhatsAppConnectionStateFromFile(tenantId).catch(() => null) : Promise.resolve(null),
    tenantId ? getInstagramConnectionStateFromFile(tenantId).catch(() => null) : Promise.resolve(null),
    prisma.appConversation.count({
      where: tenantId ? { tenantId } : {},
    }).catch(() => 0),
    prisma.appConversation.count({
      where: {
        ...(tenantId ? { tenantId } : {}),
        OR: [{ assignedFreelancerId: null }, { assignedFreelancerId: "" }],
      },
    }).catch(() => 0),
    prisma.appConversation.count({
      where: {
        ...(tenantId ? { tenantId } : {}),
        assignedFreelancerId: { not: null },
      },
    }).catch(() => 0),
    prisma.appTeamMembership.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status: "ACTIVE",
      },
      select: {
        id: true,
        freelancerId: true,
        freelancerName: true,
        roleType: true,
      },
    }).catch(() => []),
    prisma.appAssignmentRecord.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUESTED"] },
      },
      orderBy: { acceptedAt: "asc" },
    }).catch(() => []),
    effectiveAdminUserId
      ? prisma.connectedOnboardingState.findUnique({ where: { userId: effectiveAdminUserId } }).catch(() => null)
      : Promise.resolve(null),
    effectiveAdminUserId
      ? prisma.appAuthUser.findUnique({ where: { id: effectiveAdminUserId } }).catch(() => null)
      : Promise.resolve(null),
    prisma.appConversation.count({
      where: {
        ...(tenantId ? { tenantId } : {}),
        leadStatusId: { notIn: ["new", "open"] },
      },
    }).catch(() => 0),
    prisma.appPaymentRequest.findMany({
      where: tenantId ? { tenantId } : {},
      select: { requestedAmount: true, approvedAmount: true, status: true, chatThreadId: true },
    }).catch(() => []),
    prisma.appConversation.findMany({
      where: tenantId ? { tenantId } : {},
      select: { customerPhone: true, customerName: true },
    }).catch(() => []),
    listLeadStatusesFromFile().catch(() => []),
    listConversationsForAudienceFromFile("admin", { tenantId }).catch(() => ({ conversations: [] })),
    tenantId ? getAgencyListingByTenantIdFromFile(tenantId).catch(() => null) : Promise.resolve(null),
  ]);

  const liveConversations = (liveConvsPayload?.conversations ?? []) as Array<{
    id: string;
    leadStatusId?: string;
    assignedFreelancerId?: string;
  }>;
  const totalLiveConvs = liveConversations.length;

  const stageCounts: Record<string, number> = {};
  for (const conv of liveConversations) {
    const sId = conv.leadStatusId || "new";
    stageCounts[sId] = (stageCounts[sId] || 0) + 1;
  }

  const pipelineBreakdown = (liveLeadStatuses || [])
    .filter((status: { active?: boolean }) => status.active)
    .sort((a: { order: number }, b: { order: number }) => a.order - b.order)
    .map((status: { id: string; label: string; tone: string }) => ({
      statusId: status.id,
      label: status.label,
      tone: status.tone,
      count: stageCounts[status.id] || 0,
      percentage: totalLiveConvs > 0 ? Math.round(((stageCounts[status.id] || 0) / totalLiveConvs) * 100) : 0,
    }));

  const obPayload = obState?.payload && typeof obState.payload === "object" ? (obState.payload as Record<string, unknown>) : {};
  const agencyName =
    (typeof obPayload.organizationName === "string" && obPayload.organizationName.trim()) ||
    (typeof obPayload.agencyName === "string" && obPayload.agencyName.trim()) ||
    agencyListing?.publicName ||
    adminUser?.displayName ||
    (authUser?.displayName && authUser.displayName !== "Ankit Rathore" ? authUser.displayName : "Agency Workspace");

  const slowEditors = dbAssignments.map((a) => {
    const start = a.acceptedAt ? new Date(a.acceptedAt).getTime() : new Date(a.createdAt).getTime();
    const daysInProgress = Math.max(1, Math.round((now.getTime() - start) / (1000 * 60 * 60 * 24)));
    const isOverdue = Boolean(a.deadline && new Date(a.deadline).getTime() < now.getTime());
    return {
      freelancerId: a.freelancerId,
      freelancerName: a.freelancerName,
      projectTitle: a.title,
      status: a.status,
      daysInProgress,
      deadlineText: a.deadline ? new Date(a.deadline).toLocaleDateString("en-IN") : "No deadline set",
      isOverdue: isOverdue || daysInProgress >= 3,
      chatThreadId: a.chatThreadId || undefined,
    };
  }).sort((a, b) => b.daysInProgress - a.daysInProgress);

  const pendingPaymentValue = dbPaymentRequests
    .filter((p) => p.status === "PENDING" || p.status === "REQUESTED")
    .reduce((sum, p) => sum + (p.requestedAmount || 0), 0);

  const paidClientThreads = new Set(
    dbPaymentRequests
      .filter((p) => p.status === "PAID" || p.status === "APPROVED" || p.status === "COMPLETED")
      .map((p) => p.chatThreadId)
      .filter(Boolean)
  );

  const customerFrequency: Record<string, number> = {};
  for (const c of dbAllConversations) {
    const key = (c.customerPhone || c.customerName || "").trim().toLowerCase();
    if (key) {
      customerFrequency[key] = (customerFrequency[key] || 0) + 1;
    }
  }
  const repeatClientCount = Object.values(customerFrequency).filter((count) => count > 1).length;

  const projects = dbAssignments.map((a) => {
    const daysSince = a.acceptedAt ? Math.max(1, Math.round((now.getTime() - new Date(a.acceptedAt).getTime()) / (1000 * 60 * 60 * 24))) : 1;
    const isOverdue = Boolean(a.deadline && new Date(a.deadline).getTime() < now.getTime());
    return {
      id: a.id,
      title: a.title,
      specialty: a.category || "Video Editing",
      category: a.category || "Video Editing",
      openStatus: a.status.replace(/_/g, " "),
      status: a.status,
      urgency: isOverdue ? "High" : daysSince >= 3 ? "Medium" : "Normal",
      turnaround: a.deadline ? new Date(a.deadline).toLocaleDateString("en-IN") : "No deadline set",
      assignedEditorName: a.freelancerName || "Unassigned",
      freelancerName: a.freelancerName || "Unassigned",
      freelancerId: a.freelancerId,
      matchedEditorIds: a.freelancerId ? [a.freelancerId] : [],
      chatThreadId: a.chatThreadId || undefined,
    };
  });

  const realMetrics = {
    agencyName,
    totalChats: Math.max(dbTotalChats, totalLiveConvs),
    unassignedChats: Math.max(dbUnassignedChats, liveConversations.filter((c) => !c.assignedFreelancerId).length),
    assignedChats: Math.max(dbAssignedChats, liveConversations.filter((c) => Boolean(c.assignedFreelancerId)).length),
    activeTeamEditors: dbActiveMembers.length,
    activeProjects: dbAssignments.length,
    urgentProjects: slowEditors.filter((e) => e.isOverdue).length,
    slowEditors,
    projects,
    leadCount: Math.max(dbTotalChats, totalLiveConvs),
    qualifiedLeadCount: dbQualifiedChats || liveConversations.filter((c) => c.leadStatusId && c.leadStatusId !== "new").length,
    paidClientCount: paidClientThreads.size,
    repeatClientCount,
    pendingPaymentValue,
    pipelineBreakdown,
  };

  // Resolve active agency package per new business package logics (Freemium: 2 editors, 5 projects; Premium: Unlimited)
  const effectivePackage = effectiveAdminUserId
    ? await getEffectiveBillingPackageForUser(effectiveAdminUserId).catch(() => null)
    : null;

  const pkg = effectivePackage?.package;
  const isPremium = Boolean(pkg?.name?.toLowerCase().includes("premium"));
  const isFreemium = !pkg || Boolean(pkg.isFree) || pkg.slug === "agency-freemium" || Boolean(pkg.name?.toLowerCase().includes("freemium")) || pkg.name === "Standard";
  const planName = isPremium
    ? "Agency Premium"
    : isFreemium
      ? "Agency Freemium (7-Day Trial)"
      : pkg?.name || "Agency Launch";

  const editorLimit = isPremium ? null : isFreemium ? 2 : (pkg?.editorFreelancerLimit ?? pkg?.teamMemberLimit ?? 2);
  const projectLimit = isPremium ? null : isFreemium ? 5 : (pkg?.activeProjectLimit ?? 5);
  const activeSeats = dbActiveMembers.length;
  const seatsUsedLabel = `${activeSeats}/${editorLimit ? editorLimit : "Unlimited"}`;
  const projectLimitLabel = projectLimit ? String(projectLimit) : "Unlimited";
  const planNote = isPremium
    ? "Agency Premium — Unlimited editors & active projects"
    : isFreemium
      ? "Agency Freemium (7-Day Trial) — 2 editors, 5 active projects"
      : `${planName} — ${editorLimit ? `${editorLimit} editors` : "Unlimited editors"}, ${projectLimit ? `${projectLimit} active projects` : "unlimited projects"}`;

  const resolvedPlan = {
    agencyId: tenantId,
    agencyName,
    planName,
    seatLimit: editorLimit ?? 999,
    activeSeats,
    invitedSeats: 0,
    managerLimit: 10,
    activeManagers: 1,
    seatsUsedLabel,
    projectLimit,
    projectLimitLabel,
    monthlySubscription: pkg?.amount ?? 0,
    setupFee: 0,
    subscriptionHealth: "Healthy" as const,
    renewalWindow: planNote,
    monthlyRevenue: 0,
    securedPayoutVolume: pendingPaymentValue,
  };

  const enhancedSnapshot = {
    ...snapshot,
    plan: {
      ...snapshot.plan,
      ...resolvedPlan,
    },
  };

  const enhancedRealMetrics = {
    ...realMetrics,
    plan: resolvedPlan,
  };

  return NextResponse.json({
    ok: true,
    snapshot: enhancedSnapshot,
    realMetrics: enhancedRealMetrics,
    pipelineBreakdown,
    channels: {
      whatsapp: buildWhatsAppChannel(whatsappConnection),
      instagram: buildInstagramChannel(instagramConnection),
    },
  });
}
