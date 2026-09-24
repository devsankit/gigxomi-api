import "server-only";

import type { SessionUser } from "@/lib/auth/types";
import { getManagedAuthUsers } from "@/lib/auth/store";
import { getPublicAuthIntentOverview } from "@/lib/auth/public-auth-intent-store";
import { getPublicAuthOtpChannelInfo } from "@/lib/auth/public-whatsapp";
import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { prisma } from "@/lib/prisma";
import { getMarketingIntegrationSettings } from "@/lib/gigxomi/public-growth-store";
import {
  adminDashboardSnapshots,
  agencyPlans,
  managerDashboardSnapshots,
  superAdminDashboardSnapshot,
  type AdminDashboardSnapshot,
  type DashboardKpi,
  type ManagerDashboardSnapshot,
  type SuperAdminDashboardSnapshot,
} from "@/lib/gigxomi/business-ecosystem-data";
import { listConversationsForAudienceFromFile, listWhatsAppConnectionStatesFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

function replaceKpi(kpis: DashboardKpi[], label: string, value: string, note?: string) {
  return kpis.map((item) => (item.label === label ? { ...item, value, note: note ?? item.note } : item));
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function toCountLabel(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function uniqueTenantCount(tenantIds: Array<string | null>) {
  return new Set(tenantIds.filter((value): value is string => Boolean(value))).size;
}

function extractFirstInteger(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function startOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function toInr(amount: number) {
  return `INR ${Math.round(amount).toLocaleString("en-IN")}`;
}

function percentage(numerator: number, denominator: number) {
  if (!denominator) {
    return 0;
  }

  return Math.round((numerator / denominator) * 100);
}

function statusFromRisk(count: number) {
  if (count === 0) {
    return "Healthy" as const;
  }

  return count > 2 ? ("Critical" as const) : ("Watch" as const);
}

export async function buildManagerDashboardSnapshot(
  session: Pick<SessionUser, "role" | "tenantId">,
): Promise<ManagerDashboardSnapshot> {
  const tenantId = resolveSessionTenantId(session);
  const fallback = managerDashboardSnapshots[tenantId] ?? managerDashboardSnapshots["tenant-gigxomi"];
  const [live, appAssignments] = await Promise.all([
    listConversationsForAudienceFromFile("manager", {
      activeAgencyIds: [tenantId],
      includeSupportData: true,
    }),
    prisma.appAssignmentRecord.findMany({ where: { tenantId } }),
  ]);

  const openConversations = live.conversations.filter((item) => item.status !== "Closed");
  const assignmentReadyEditors = live.assignableEditors.filter(
    (item) => item.workloadBand !== "Near Capacity" && item.karmaScore >= 72,
  );
  const pendingQuoteReviews = live.conversations.filter((item) => {
    const paymentStatus = item.latestPaymentRequest?.status;
    return Boolean(paymentStatus && paymentStatus !== "Paid" && paymentStatus !== "Cancelled" && paymentStatus !== "Failed");
  });
  const appDeliveryRisks = appAssignments.filter((item) => ["SUBMITTED", "REVISION_REQUESTED"].includes(item.status));
  const deliveryRisks = live.conversations.filter(
    (item) => item.status === "Active" && (item.unreadCount > 0 || item.leadStatusTone === "warning"),
  );
  const escalations = live.conversations.filter(
    (item) => item.status === "Manager Review" || item.leadStatusTone === "warning",
  );
  const securityChecks = live.conversations.filter((item) => {
    const paymentStatus = item.latestPaymentRequest?.status;
    return paymentStatus === "Draft" || paymentStatus === "Sent" || paymentStatus === "Viewed";
  });

  const inboxQueue =
    openConversations.slice(0, 3).map((item) => ({
      label: item.serviceTitle,
      status: item.leadStatusLabel,
      note: item.summary,
      owner: item.ownerName ?? item.assignedFreelancerName ?? "Unassigned",
    })) || fallback.inboxQueue;

  const assignmentBoard =
    assignmentReadyEditors.slice(0, 3).map((item) => ({
      title: item.name,
      editor: item.specialties[0] ?? "General queue",
      workload: item.workloadBand,
      note: `${item.karmaScore}/100 karma and available for the next routed brief.`,
    })) || fallback.assignmentBoard;

  const riskBoard =
    [
      ...securityChecks.slice(0, 1).map((item) => ({
        title: item.serviceTitle,
        risk: "High",
        note: `${item.latestPaymentRequest?.status ?? "Payment hold"} is still blocking safe start.`,
      })),
      ...deliveryRisks.slice(0, 1).map((item) => ({
        title: item.serviceTitle,
        risk: "Medium",
        note: `${item.unreadCount} unread update${item.unreadCount === 1 ? "" : "s"} on an active delivery.`,
      })),
      ...live.conversations
        .filter((item) => item.status === "New")
        .slice(0, 1)
        .map((item) => ({
          title: item.serviceTitle,
          risk: "Low",
          note: "New intake still needs first routing and shortlist confirmation.",
        })),
    ].filter((item) => item.note.trim().length > 0) || fallback.riskBoard;

  const quoteBoard =
    pendingQuoteReviews.slice(0, 3).map((item) => ({
      title: item.serviceTitle,
      stage: item.latestPaymentRequest?.status ?? item.leadStatusLabel,
      note: `${item.customerDisplayName} - ${item.summary}`,
    })) || fallback.quoteBoard;

  return {
    ...fallback,
    kpis: replaceKpi(
      replaceKpi(
        replaceKpi(
          replaceKpi(
            replaceKpi(
              replaceKpi(fallback.kpis, "Waiting chats", String(openConversations.length), "Open queue items across this tenant."),
              "Assignment-ready editors",
              String(assignmentReadyEditors.length),
              "Editors with healthy load and usable karma.",
            ),
            "Pending quote reviews",
            String(pendingQuoteReviews.length),
            "Live quote/payment requests still waiting on action.",
          ),
          "Delivery risks",
          String(deliveryRisks.length + appDeliveryRisks.length),
          "Active work with unread pressure, submitted delivery, or revision state.",
        ),
        "Escalations",
        String(escalations.length),
        "Conversations already asking for closer oversight.",
      ),
      "Security checks",
      String(securityChecks.length),
      "Payment or proof items still blocking safe execution.",
    ),
    inboxQueue: inboxQueue.length ? inboxQueue : fallback.inboxQueue,
    assignmentBoard: assignmentBoard.length ? assignmentBoard : fallback.assignmentBoard,
    riskBoard: riskBoard.length ? riskBoard : fallback.riskBoard,
    quoteBoard: quoteBoard.length ? quoteBoard : fallback.quoteBoard,
  };
}

export async function buildAdminDashboardSnapshot(
  session: Pick<SessionUser, "role" | "tenantId">,
): Promise<AdminDashboardSnapshot> {
  const tenantId = resolveSessionTenantId(session);
  const fallback = adminDashboardSnapshots[tenantId] ?? adminDashboardSnapshots["tenant-gigxomi"];
  const [managedUsers, live, appAssignments, appTeamMemberships, appPaymentRequests] = await Promise.all([
    getManagedAuthUsers(),
    listConversationsForAudienceFromFile("admin", {
      activeAgencyIds: [tenantId],
      includeSupportData: true,
    }),
    prisma.appAssignmentRecord.findMany({ where: { tenantId } }),
    prisma.appTeamMembership.findMany({ where: { tenantId, status: "ACTIVE" } }),
    prisma.appPaymentRequest.findMany({ where: { tenantId } }),
  ]);

  const tenantUsers = managedUsers.filter((item) => item.tenantId === tenantId);
  const tenantFreelancers = tenantUsers.filter(
    (item) => item.role === "FREELANCER" || item.assignedRole === "FREELANCER",
  );
  const tenantManagers = tenantUsers.filter((item) => item.role === "MANAGER" || item.assignedRole === "MANAGER");
  const openConversations = live.conversations.filter((item) => item.status !== "Closed");
  const activeProjects = [
    ...live.conversations.filter((item) => item.status === "Assigned" || item.status === "Active"),
    ...appAssignments.filter((item) => !["COMPLETED", "PAYMENT_APPROVED", "PAID", "CANCELLED", "DISPUTED"].includes(item.status)),
  ];
  const paymentProtectedVolume = live.conversations.reduce((sum, item) => {
    const request = item.latestPaymentRequest;
    if (!request || request.status === "Cancelled" || request.status === "Failed") {
      return sum;
    }

    return sum + request.amount;
  }, 0) + appPaymentRequests
    .filter((item) => ["PAYMENT_PENDING", "WALLET_CREDITED", "EDITOR_PAYOUT_PAID"].includes(item.status))
    .reduce((sum, item) => sum + item.requestedAmount, 0);
  const averageKarma = average(live.assignableEditors.map((item) => item.karmaScore));

  return {
    ...fallback,
    kpis: replaceKpi(
      replaceKpi(
        replaceKpi(
          replaceKpi(
            replaceKpi(
              fallback.kpis,
              "Active seats",
              `${Math.max(tenantFreelancers.length, appTeamMemberships.length) || fallback.plan.activeSeats} / ${fallback.plan.seatLimit}`,
              "Current freelancer identities mapped to this tenant.",
            ),
            "Active chats",
            String(openConversations.length),
            "Open tenant conversations across intake and delivery.",
          ),
          "Active projects",
          String(activeProjects.length),
          "Assigned or active work visible in the live queue.",
        ),
        "Secured payout amount",
        paymentProtectedVolume > 0 ? `INR ${paymentProtectedVolume.toLocaleString("en-IN")}` : fallback.kpis[4]?.value ?? "INR 0",
        "Latest payment requests still visible to the tenant dashboard.",
      ),
      "Average editor karma",
      averageKarma ? String(averageKarma) : fallback.kpis[6]?.value ?? "-",
      "Average from currently assignable editor profiles.",
    ).map((item) =>
      item.label === "Manager SLA health"
        ? {
            ...item,
            value: `${tenantManagers.length || fallback.plan.activeManagers} managers`,
            note: "Tenant operators currently available in app access.",
          }
        : item,
    ),
  };
}

export async function buildSuperAdminOverviewData() {
  const [managedUsers, otpChannel, authOverview, marketingSettings] = await Promise.all([
    getManagedAuthUsers(),
    getPublicAuthOtpChannelInfo(),
    getPublicAuthIntentOverview(),
    getMarketingIntegrationSettings(),
  ]);

  const agencyUsers = managedUsers.filter(
    (item) => item.packageAudience === "AGENCY" || item.role === "ADMIN" || item.assignedRole === "ADMIN",
  );
  const managerUsers = managedUsers.filter((item) => item.role === "MANAGER" || item.assignedRole === "MANAGER");
  const liveAgencyCount = uniqueTenantCount(agencyUsers.map((item) => item.tenantId));
  const activeAgencyPackages = agencyUsers.filter((item) => item.packageStatus === "ACTIVE").length;
  const onboardingAgencyPackages = agencyUsers.filter((item) => item.packageStatus !== "ACTIVE").length;
  const baseActiveEditors =
    extractFirstInteger(
      superAdminDashboardSnapshot.kpis.find((item) => item.label === "Active editors")?.value ?? "0",
    ) || 0;
  const baseActiveManagers =
    extractFirstInteger(
      superAdminDashboardSnapshot.kpis.find((item) => item.label === "Active managers")?.value ?? "0",
    ) || 0;

  const [subscriptions, transactions, packages, appServices, appConversations, appPaymentRequests, appWalletEntries, whatsappStates] = await Promise.all([
    prisma.userSubscription.findMany({
      select: {
        status: true,
        paymentStatus: true,
        amount: true,
        createdAt: true,
        renewsAt: true,
        expiresAt: true,
        userId: true,
        packageId: true,
        package: {
          select: {
            name: true,
            packageType: true,
            teamMemberLimit: true,
          },
        },
      },
    }),
    prisma.paymentTransaction.findMany({
      select: {
        status: true,
        amount: true,
        paidAt: true,
        createdAt: true,
        package: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.package.findMany({
      select: {
        id: true,
        name: true,
        packageType: true,
        amount: true,
        setupFee: true,
        teamMemberLimit: true,
        isActive: true,
      },
      orderBy: {
        sortOrder: "asc",
      },
    }),
    prisma.appFreelancerService.findMany({
      select: {
        id: true,
        ownerId: true,
        status: true,
        payload: true,
      },
    }),
    prisma.appConversation.findMany({
      select: {
        id: true,
        tenantId: true,
        assignedFreelancerId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.appPaymentRequest.findMany({
      select: {
        id: true,
        status: true,
        requestedAmount: true,
        platformCommissionAmount: true,
        freelancerWalletAmount: true,
        tenantId: true,
      },
    }),
    prisma.appFreelancerWalletEntry.findMany({
      select: {
        id: true,
        status: true,
        grossAmount: true,
        commissionAmount: true,
        netAmount: true,
      },
    }),
    listWhatsAppConnectionStatesFromFile().catch(() => []),
  ]);

  const monthStart = startOfCurrentMonth();
  const activeSubscriptions = subscriptions.filter((item) => item.status === "ACTIVE");
  const mrr = activeSubscriptions.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const newAgenciesThisMonth = new Set(
    agencyUsers
      .filter((item) => {
        const createdAt = item.createdAt ? new Date(item.createdAt) : null;
        return createdAt && !Number.isNaN(createdAt.getTime()) && createdAt >= monthStart;
      })
      .map((item) => item.tenantId)
      .filter((value): value is string => Boolean(value)),
  ).size;
  const renewalRiskCount = agencyUsers.filter(
    (item) => item.packageStatus === "EXPIRED" || (item.packageExpiresAt ? new Date(item.packageExpiresAt).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000 : false),
  ).length;
  const failedTransactions = transactions.filter((item) => item.status === "FAILED");
  const pendingTransactions = transactions.filter((item) => item.status === "PENDING" || item.status === "INITIATED");
  const pendingEditorPaymentRequests = appPaymentRequests.filter((item) => ["PAYMENT_PENDING", "PAYMENT_FAILED"].includes(item.status));
  const pendingFailedAmount =
    [...failedTransactions, ...pendingTransactions].reduce((sum, item) => sum + Number(item.amount ?? 0), 0) +
    pendingEditorPaymentRequests.reduce((sum, item) => sum + item.requestedAmount, 0);
  const successfulTransactions = transactions.filter((item) => item.status === "SUCCESS");
  const collectedRevenueMonth = transactions
    .filter((item) => item.status === "SUCCESS" && item.paidAt && item.paidAt >= monthStart)
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const projectedNextMonthRevenue = Math.round(mrr * 0.92);
  const setupFeeRevenue = successfulTransactions
    .filter((item) => item.package?.name?.toLowerCase().includes("setup"))
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const subscriptionRevenue = successfulTransactions.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const arr = mrr * 12;
  const averageRevenuePerAgency = liveAgencyCount ? Math.round(mrr / liveAgencyCount) : 0;
  const upcomingRenewals = subscriptions.filter((item) => {
    const nextDate = item.renewsAt ?? item.expiresAt;
    return item.status === "ACTIVE" && nextDate && nextDate.getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000;
  });
  const expiredSubscriptions = subscriptions.filter((item) => item.status === "EXPIRED");
  const activeAgencyUsers = agencyUsers.filter((item) => item.packageStatus === "ACTIVE");
  const inactiveAgencyUsers = agencyUsers.filter((item) => item.packageStatus !== "ACTIVE");
  const agenciesNoRecentLogin = agencyUsers.filter((item) => {
    if (!item.lastLoginAt) return true;
    const lastLogin = new Date(item.lastLoginAt);
    return Number.isNaN(lastLogin.getTime()) || lastLogin.getTime() <= Date.now() - 30 * 24 * 60 * 60 * 1000;
  });
  const whatsappConnectedTenants = new Set(
    whatsappStates
      .filter((item) => item.status === "Ready for webhook" || item.status === "Number connected")
      .map((item) => item.tenantId)
      .filter((value): value is string => Boolean(value)),
  );
  const agenciesWithoutWhatsapp = agencyUsers.filter((item) => item.tenantId && !whatsappConnectedTenants.has(item.tenantId));
  const freelancerUsers = managedUsers.filter((item) => item.role === "FREELANCER" || item.assignedRole === "FREELANCER");
  const approvedServiceCount = appServices.filter((item) => item.status === "Approved" || item.status === "APPROVED").length;
  const pendingServiceCount = appServices.filter((item) => String(item.status).toLowerCase().includes("pending")).length;
  const idleEditors = freelancerUsers.filter((user) => !appConversations.some((conversation) => conversation.assignedFreelancerId === user.id && conversation.status !== "Closed"));
  const openConversations = appConversations.filter((item) => item.status !== "Closed");
  const assignedConversations = appConversations.filter((item) => Boolean(item.assignedFreelancerId));
  const gaConnected = Boolean(marketingSettings.ga4MeasurementId);
  const gscConnected = Boolean(marketingSettings.searchConsoleSiteUrl || marketingSettings.searchConsoleVerification);

  const packagePerformance = packages.map((pkg) => {
    const pkgSubscriptions = subscriptions.filter((subscription) => subscription.packageId === pkg.id);
    const pkgMrr = pkgSubscriptions
      .filter((subscription) => subscription.status === "ACTIVE")
      .reduce((sum, subscription) => sum + Number(subscription.amount ?? 0), 0);
    return {
      name: pkg.name,
      agencies: pkgSubscriptions.length,
      mrr: toInr(pkgMrr),
      utilization: pkg.teamMemberLimit ? `${pkg.teamMemberLimit} seat limit` : "Seat limit not set",
      status: pkg.isActive ? "Active" : "Inactive",
    };
  });

  const agencyHealthRows = agencyUsers.slice(0, 8).map((agency) => {
    const noRecentLogin = agenciesNoRecentLogin.some((item) => item.id === agency.id);
    const noWhatsapp = Boolean(agency.tenantId && !whatsappConnectedTenants.has(agency.tenantId));
    const riskScore = [agency.packageStatus !== "ACTIVE", noRecentLogin, noWhatsapp].filter(Boolean).length;
    return {
      agency: agency.displayName,
      package: agency.packageName ?? "No package",
      status: agency.packageStatus ?? "PENDING",
      health: riskScore === 0 ? "Healthy" : riskScore === 1 ? "Watch" : "Critical",
      reason: riskScore === 0 ? "Package and activity look usable." : [noRecentLogin ? "No recent login" : "", noWhatsapp ? "WhatsApp not connected" : "", agency.packageStatus !== "ACTIVE" ? "Package not active" : ""].filter(Boolean).join(", "),
    };
  });

  const editorSupplyRows = freelancerUsers.slice(0, 8).map((editor) => {
    const assignedCount = appConversations.filter((conversation) => conversation.assignedFreelancerId === editor.id).length;
    return {
      editor: editor.displayName,
      status: editor.packageStatus ?? "PENDING",
      activeWork: String(assignedCount),
      readiness: assignedCount === 0 ? "Idle" : assignedCount > 3 ? "Busy" : "Active",
      package: editor.packageName ?? "No package",
    };
  });

  const executiveSignals = [
    {
      key: "mrr",
      label: "MRR / Subscription Revenue",
      value: mrr > 0 ? toInr(mrr) : "Data source needed",
      trend: mrr > 0 ? "Live recurring revenue from active subscriptions." : "No active recurring subscription data yet.",
      status: mrr > 0 ? "Healthy" : "Watch",
      interpretation: mrr > 0 ? "Recurring revenue is active." : "Subscription ledger needs active recurring rows.",
      isPlaceholder: mrr <= 0,
    },
    {
      key: "projected-revenue",
      label: "Projected Next-Month Revenue",
      value: mrr > 0 ? toInr(projectedNextMonthRevenue) : "Data source needed",
      trend: "Projection uses active MRR baseline and conservative retention factor.",
      status: mrr > 0 ? "Watch" : "Watch",
      interpretation: mrr > 0 ? "Forecast assumes 8% risk on current recurring base." : "Projection depends on recurring subscription activity.",
      isPlaceholder: mrr <= 0,
    },
    {
      key: "active-agencies",
      label: "Active Agencies",
      value: String(Math.max(liveAgencyCount, agencyPlans.length)),
      trend: `${newAgenciesThisMonth} new this month`,
      status: liveAgencyCount > 0 ? "Healthy" : "Watch",
      interpretation: liveAgencyCount > 0 ? "Agency footprint is measurable from auth tenancy." : "Agency tenancy data is thin.",
      isPlaceholder: false,
    },
    {
      key: "new-agencies-month",
      label: "New Agencies This Month",
      value: String(newAgenciesThisMonth),
      trend: "Derived from managed user creation dates and tenant mapping.",
      status: newAgenciesThisMonth > 0 ? "Healthy" : "Watch",
      interpretation: newAgenciesThisMonth > 0 ? "New agency intake is active." : "No new agencies added this month.",
      isPlaceholder: false,
    },
    {
      key: "renewal-risk",
      label: "Churn / Renewal Risk",
      value: `${renewalRiskCount} agencies`,
      trend: "Expired or near-expiry package windows inside 7 days.",
      status: renewalRiskCount === 0 ? "Healthy" : renewalRiskCount < 3 ? "Watch" : "Critical",
      interpretation: renewalRiskCount === 0 ? "No immediate renewal risk detected." : "Renewal follow-up is required.",
      isPlaceholder: false,
    },
    {
      key: "pending-failed-payments",
      label: "Pending + Failed Payments",
      value: `${failedTransactions.length + pendingTransactions.length + pendingEditorPaymentRequests.length} tx (${toInr(pendingFailedAmount)})`,
      trend: `${failedTransactions.length} failed / ${pendingTransactions.length + pendingEditorPaymentRequests.length} pending`,
      status: failedTransactions.length === 0 && !pendingEditorPaymentRequests.some((item) => item.status === "PAYMENT_FAILED") ? "Watch" : "Critical",
      interpretation: failedTransactions.length === 0 ? "Pending queue needs follow-up." : "Revenue leakage risk is present.",
      isPlaceholder: false,
    },
    {
      key: "active-editors",
      label: "Active Editors / Freelancers",
      value: String(
        Math.max(
          managedUsers.filter((item) => item.role === "FREELANCER" || item.assignedRole === "FREELANCER").length,
          baseActiveEditors,
        ),
      ),
      trend: "Current active identity pool for marketplace supply.",
      status: "Healthy",
      interpretation: "Supply visibility exists; demand-fit analytics pending.",
      isPlaceholder: false,
    },
    {
      key: "marketplace-demand-score",
      label: "Marketplace Demand Score",
      value: "Tracking not connected",
      trend: "Prompt/search telemetry events are required.",
      status: "Watch",
      interpretation: "Demand intelligence will activate after search event tracking.",
      isPlaceholder: true,
    },
  ] as const;

  const smartInsights = [
    renewalRiskCount > 0
      ? {
          title: `${renewalRiskCount} agencies are near renewal risk`,
          impact: "Potential recurring revenue loss in next 7 days.",
          action: "Review renewals and trigger follow-up from billing control.",
          severity: renewalRiskCount > 2 ? "Critical" : "Watch",
        }
      : null,
    failedTransactions.length > 0
      ? {
          title: `${failedTransactions.length} failed payments detected`,
          impact: `${toInr(failedTransactions.reduce((sum, item) => sum + Number(item.amount ?? 0), 0))} is currently blocked.`,
          action: "Prioritize payment recovery outreach for failed transactions.",
          severity: "Critical",
        }
      : null,
    {
      title: "Marketplace demand intelligence is not connected",
      impact: "Founder cannot see keyword-level demand and no-result gaps yet.",
      action: "Implement prompt_search event tracking before growth sprints.",
      severity: "Watch",
    },
  ]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 3);

  const criticalAlerts = [
    ...(failedTransactions.length
      ? [
          {
            label: "Failed Payments",
            impactAmount: toInr(failedTransactions.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)),
            reason: "Payment transactions in failed state.",
            urgency: "Critical",
            action: "Open billing control and retry/assist failed payments.",
          },
        ]
      : []),
    ...(pendingTransactions.length
      ? [
          {
            label: "Pending Payments",
            impactAmount: toInr(pendingTransactions.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)),
            reason: "Transactions still pending confirmation.",
            urgency: "Watch",
            action: "Follow up pending confirmations and customer actions.",
          },
        ]
      : []),
    ...(renewalRiskCount > 0
      ? [
          {
            label: "Renewal Risk",
            impactAmount: "Data source needed",
            reason: "Agencies with expiry in 7 days or already expired.",
            urgency: renewalRiskCount > 2 ? "Critical" : "Watch",
            action: "Prioritize renewal campaign and account outreach.",
          },
        ]
      : []),
  ];

  const revenueIntelligence = {
    metrics: [
      { label: "MRR", value: mrr > 0 ? toInr(mrr) : "Data source needed", status: mrr > 0 ? "Healthy" : "Watch", note: "Active recurring subscription amount." },
      { label: "ARR", value: mrr > 0 ? toInr(arr) : "Data source needed", status: mrr > 0 ? "Healthy" : "Watch", note: "MRR annualized." },
      { label: "Collected Revenue", value: toInr(collectedRevenueMonth + appPaymentRequests.filter((item) => ["WALLET_CREDITED", "EDITOR_PAYOUT_PAID"].includes(item.status)).reduce((sum, item) => sum + item.requestedAmount, 0)), status: collectedRevenueMonth > 0 || appPaymentRequests.some((item) => item.status === "WALLET_CREDITED") ? "Healthy" : "Watch", note: "Successful package and editor-payment collections." },
      { label: "Pending Revenue", value: toInr(pendingTransactions.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)), status: pendingTransactions.length ? "Watch" : "Healthy", note: "Pending or initiated transactions." },
      { label: "Failed Payments", value: toInr(failedTransactions.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)), status: failedTransactions.length ? "Critical" : "Healthy", note: "Failed payment amount." },
      { label: "Setup Fee Revenue", value: setupFeeRevenue > 0 ? toInr(setupFeeRevenue) : "Data source needed", status: setupFeeRevenue > 0 ? "Healthy" : "Watch", note: "Requires setup transaction tagging for precision." },
      { label: "Subscription Revenue", value: subscriptionRevenue > 0 ? toInr(subscriptionRevenue) : "Data source needed", status: subscriptionRevenue > 0 ? "Healthy" : "Watch", note: "Successful package payment transactions." },
      { label: "Average Revenue / Agency", value: averageRevenuePerAgency > 0 ? toInr(averageRevenuePerAgency) : "Data source needed", status: averageRevenuePerAgency > 0 ? "Healthy" : "Watch", note: "MRR divided by active agency tenants." },
    ],
    packageRows: packagePerformance,
  };

  const subscriptionIntelligence = {
    metrics: [
      { label: "Active Subscriptions", value: String(activeSubscriptions.length), status: activeSubscriptions.length ? "Healthy" : "Watch", note: "Active user subscriptions." },
      { label: "Expired Subscriptions", value: String(expiredSubscriptions.length), status: statusFromRisk(expiredSubscriptions.length), note: "Subscriptions in expired state." },
      { label: "Upcoming Renewals", value: String(upcomingRenewals.length), status: upcomingRenewals.length ? "Watch" : "Healthy", note: "Renewals or expiries inside 30 days." },
      { label: "Renewal Risk", value: `${renewalRiskCount} agencies`, status: statusFromRisk(renewalRiskCount), note: "Agency accounts expired or near expiry." },
      { label: "Seats Billed vs Used", value: "Data source needed", status: "Watch", note: "Requires normalized seat billing ledger." },
      { label: "Package Utilization", value: `${percentage(activeAgencyPackages, Math.max(agencyUsers.length, 1))}% active`, status: activeAgencyPackages ? "Healthy" : "Watch", note: "Active package status across agency users." },
    ],
    packageRows: packagePerformance,
  };

  const agencyHealth = {
    metrics: [
      { label: "Active Agencies", value: String(activeAgencyUsers.length), status: activeAgencyUsers.length ? "Healthy" : "Watch", note: "Agency users with active package." },
      { label: "Inactive Agencies", value: String(inactiveAgencyUsers.length), status: statusFromRisk(inactiveAgencyUsers.length), note: "Agency users not in active package state." },
      { label: "No Recent Login", value: String(agenciesNoRecentLogin.length), status: statusFromRisk(agenciesNoRecentLogin.length), note: "No login in the last 30 days or no login recorded." },
      { label: "No WhatsApp Connected", value: String(agenciesWithoutWhatsapp.length), status: statusFromRisk(agenciesWithoutWhatsapp.length), note: "No ready/connected WhatsApp state for tenant." },
      { label: "Unpaid Invoices", value: `${pendingTransactions.length + failedTransactions.length}`, status: statusFromRisk(pendingTransactions.length + failedTransactions.length), note: "Pending and failed payment transactions." },
    ],
    rows: agencyHealthRows,
  };

  const marketplaceDemand = {
    metrics: [
      { label: "Top Searches", value: "Tracking not connected", status: "Watch", note: "Needs prompt_search_submitted event." },
      { label: "No-result Searches", value: "Tracking not connected", status: "Watch", note: "Needs prompt_search_no_result event." },
      { label: "Demand vs Supply Gap", value: "Tracking not connected", status: "Watch", note: "Needs search and editor skill graph." },
    ],
    rows: [
      { label: "wedding teaser", demand: "Data source needed", gap: "Search telemetry missing", action: "Track keyword demand." },
      { label: "YouTube editor", demand: "Data source needed", gap: "Search telemetry missing", action: "Track result clicks." },
      { label: "Instagram ads editor", demand: "Data source needed", gap: "Search telemetry missing", action: "Track search-to-chat rate." },
    ],
  };

  const searchQuality = {
    metrics: [
      { label: "Searches With Results", value: "Tracking not connected", status: "Watch", note: "Needs search result event stream." },
      { label: "Profile CTR", value: "Tracking not connected", status: "Watch", note: "Needs prompt_search_result_clicked event." },
      { label: "Recommendation Confidence", value: "Tracking not connected", status: "Watch", note: "Needs recommendation scoring output." },
    ],
    rows: [
      { keyword: "Data source needed", issue: "No search event stream yet", action: "Add prompt search tracking." },
    ],
  };

  const editorSupply = {
    metrics: [
      { label: "Total Editors", value: String(freelancerUsers.length), status: freelancerUsers.length ? "Healthy" : "Watch", note: "Freelancer identities in auth store." },
      { label: "Approved Services", value: String(approvedServiceCount), status: approvedServiceCount ? "Healthy" : "Watch", note: "Approved service records." },
      { label: "Pending Approval", value: String(pendingServiceCount), status: pendingServiceCount ? "Watch" : "Healthy", note: "Pending service records." },
      { label: "Idle Editors", value: String(idleEditors.length), status: idleEditors.length ? "Watch" : "Healthy", note: "No current assigned app conversations." },
      { label: "Demand Skill Gaps", value: "Tracking not connected", status: "Watch", note: "Requires search demand graph." },
    ],
    rows: editorSupplyRows,
  };

  const marketingSeo = {
    metrics: [
      { label: "Google Analytics", value: gaConnected ? "Connected" : "Connect GA4", status: gaConnected ? "Healthy" : "Watch", note: gaConnected ? "Measurement ID configured." : "GA4 connector/settings needed." },
      { label: "Search Console", value: gscConnected ? "Configured" : "Connect GSC", status: gscConnected ? "Healthy" : "Watch", note: gscConnected ? "Search Console setting exists." : "Search Console integration needed." },
      { label: "Top SEO Queries", value: "Connector needed", status: "Watch", note: "Requires GSC ingestion." },
      { label: "Keyword-to-signup", value: "Tracking not connected", status: "Watch", note: "Requires attribution events." },
    ],
  };

  const automationIntelligence = {
    metrics: [
      { label: "Open Conversations", value: String(openConversations.length), status: openConversations.length ? "Watch" : "Healthy", note: "Current app conversation backlog." },
      { label: "Assigned Conversations", value: String(assignedConversations.length), status: assignedConversations.length ? "Healthy" : "Watch", note: "Conversations with assigned freelancer." },
      { label: "Bot Replies", value: "Tracking not connected", status: "Watch", note: "Needs bot_reply_sent event." },
      { label: "Human Handoff", value: "Tracking not connected", status: "Watch", note: "Needs human_handoff event." },
      { label: "WhatsApp Connected Agencies", value: String(whatsappConnectedTenants.size), status: whatsappConnectedTenants.size ? "Healthy" : "Watch", note: "Ready/connected WhatsApp tenant states." },
      { label: "Automation Value Saved", value: "Tracking not connected", status: "Watch", note: "Requires bot handling and time-value model." },
    ],
  };

  const financialRisk = {
    metrics: [
      { label: "Revenue At Risk", value: pendingFailedAmount > 0 ? toInr(pendingFailedAmount) : "INR 0", status: pendingFailedAmount > 0 ? "Critical" : "Healthy", note: "Pending plus failed payment amount." },
      { label: "Failed Payments", value: String(failedTransactions.length), status: statusFromRisk(failedTransactions.length), note: "Failed payment transactions." },
      { label: "Expired Subscriptions", value: String(expiredSubscriptions.length), status: statusFromRisk(expiredSubscriptions.length), note: "Expired subscription rows." },
      { label: "Wallet Credits", value: toInr(appWalletEntries.filter((item) => item.status === "AVAILABLE").reduce((sum, item) => sum + item.netAmount, 0)), status: appWalletEntries.length ? "Healthy" : "Watch", note: "Editor wallet amount available after platform collection." },
      { label: "Unbilled Seat Usage", value: "Data source needed", status: "Watch", note: "Requires seat usage vs billing ledger." },
    ],
  };

  const quickActions = [
    { label: "Review renewals", target: "/super-admin/billing-control", reason: "Resolve renewal risk and subscription follow-up." },
    { label: "Follow up payments", target: "/super-admin/billing-control", reason: "Recover pending or failed payment value." },
    { label: "Approve editors", target: "/super-admin/approvals", reason: "Move supply through review queues." },
    { label: "View search demand", target: "/super-admin", reason: "Connect search telemetry before this action becomes live." },
    { label: "Connect analytics", target: "/super-admin/marketing", reason: "Enable GA/GSC growth intelligence." },
    { label: "Review high-risk agencies", target: "/super-admin/agencies", reason: "Open agency control table." },
  ];

  const snapshot: SuperAdminDashboardSnapshot = {
    ...superAdminDashboardSnapshot,
    kpis: replaceKpi(
      replaceKpi(
        replaceKpi(
          replaceKpi(
            superAdminDashboardSnapshot.kpis,
            "Total agencies",
            String(Math.max(liveAgencyCount, agencyPlans.length)),
            "Tenant count seen across agency subscriptions and admin identities.",
          ),
          "Active subscriptions",
          activeAgencyPackages + onboardingAgencyPackages > 0
            ? `${activeAgencyPackages} live / ${onboardingAgencyPackages} onboarding`
            : superAdminDashboardSnapshot.kpis[1]?.value ?? "0 live / 0 onboarding",
          "Agency package visibility coming from the live auth store.",
        ),
        "Active editors",
        toCountLabel(
          Math.max(
            managedUsers.filter((item) => item.role === "FREELANCER" || item.assignedRole === "FREELANCER").length,
            baseActiveEditors,
          ),
          "editor",
          "editors",
        ),
        "Live freelancer identities currently available to platform access control.",
      ),
      "Active managers",
      toCountLabel(Math.max(managerUsers.length, baseActiveManagers), "manager", "managers"),
      "Internal manager identities currently available in auth access control.",
    ),
  };

  return {
    snapshot,
    otpChannel,
    authOverview,
    intelligence: {
      executiveSignals,
      smartInsights,
      criticalAlerts,
      collectedRevenueThisMonth: toInr(collectedRevenueMonth),
      revenueIntelligence,
      subscriptionIntelligence,
      agencyHealth,
      marketplaceDemand,
      searchQuality,
      editorSupply,
      marketingSeo,
      automationIntelligence,
      financialRisk,
      quickActions,
    },
  };
}
