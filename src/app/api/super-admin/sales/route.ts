import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";
import {
  createSalesAgentAccount,
  createSalesLeadPoolItem,
  getSalesSnapshotForRole,
  saveSalesAnnouncement,
  saveSalesGroup,
  saveSalesGoal,
  saveSalesReward,
  saveCommissionRule,
  deleteSalesAgentFromAdmin,
  resetSalesAgentPasswordFromAdmin,
  updateSalesAgentProfile,
  updateSalesPayoutStatus,
  updateSalesSettings,
  upsertSalesAgent,
  type SalesCommissionAppliesTo,
  type SalesCommissionRuleType,
  type SalesCommissionScope,
  type SalesGoalMetric,
  type SalesGoalScope,
  type SalesPayoutStatus,
} from "@/lib/gigxomi/sales-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  try {
    const snapshot = await getSalesSnapshotForRole(authorization.session);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    console.error("Failed to load super-admin sales overview.", error);
    return NextResponse.json({ ok: false, error: "Sales OS data is unavailable. Check database migrations and server logs." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send a valid sales control action." }, { status: 400 });

  if (body.action === "settings") {
    const settings = await updateSalesSettings({
      moduleEnabled: typeof body.moduleEnabled === "boolean" ? body.moduleEnabled : undefined,
      signupRequiresApproval: typeof body.signupRequiresApproval === "boolean" ? body.signupRequiresApproval : undefined,
      defaultCommissionPercent: Number.isFinite(Number(body.defaultCommissionPercent)) ? Number(body.defaultCommissionPercent) : undefined,
      payoutMinimum: Number.isFinite(Number(body.payoutMinimum)) ? Number(body.payoutMinimum) : undefined,
      enableAnnouncements: typeof body.enableAnnouncements === "boolean" ? body.enableAnnouncements : undefined,
      enableMessages: typeof body.enableMessages === "boolean" ? body.enableMessages : undefined,
      enableReferralLinks: typeof body.enableReferralLinks === "boolean" ? body.enableReferralLinks : undefined,
      enableTeams: typeof body.enableTeams === "boolean" ? body.enableTeams : undefined,
      enableEarnings: typeof body.enableEarnings === "boolean" ? body.enableEarnings : undefined,
      enablePayouts: typeof body.enablePayouts === "boolean" ? body.enablePayouts : undefined,
      dashboardPrimaryColor: typeof body.dashboardPrimaryColor === "string" ? body.dashboardPrimaryColor : undefined,
      dashboardAccentColor: typeof body.dashboardAccentColor === "string" ? body.dashboardAccentColor : undefined,
      leadGrabEnabled: typeof body.leadGrabEnabled === "boolean" ? body.leadGrabEnabled : undefined,
    });
    return NextResponse.json({ ok: true, settings });
  }

  if (body.action === "agent") {
    const displayName = String(body.displayName ?? "").trim();
    const email = String(body.email ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const password = String(body.password ?? "").trim();
    const existingUserId = String(body.userId ?? "").trim();
    const groupId = typeof body.groupId === "string" && body.groupId.trim() ? body.groupId.trim() : undefined;
    const parentAgentId = typeof body.parentAgentId === "string" && body.parentAgentId.trim() ? body.parentAgentId.trim() : null;

    if (!existingUserId) {
      const created = await createSalesAgentAccount({
        displayName,
        email,
        phone,
        password,
        createdByUserId: authorization.session.userId ?? undefined,
        status: body.status === "ACTIVE" || body.status === "SUSPENDED" || body.status === "PENDING" ? body.status : "PENDING",
        groupId,
        parentAgentId,
        canCreateSubAgents: body.canCreateSubAgents === true,
        canClaimLeads: body.canClaimLeads !== false,
        maxActiveLeads: Number.isFinite(Number(body.maxActiveLeads)) ? Number(body.maxActiveLeads) : 3,
      });

      if (!created.ok) {
        return NextResponse.json(created, { status: 400 });
      }
      return NextResponse.json(created);
    }

    const agent = await upsertSalesAgent({
      userId: existingUserId,
      displayName,
      email,
      phone,
      status: body.status === "ACTIVE" || body.status === "SUSPENDED" || body.status === "PENDING" ? body.status : "PENDING",
      groupId,
      parentAgentId,
      canCreateSubAgents: body.canCreateSubAgents === true,
      canClaimLeads: body.canClaimLeads !== false,
      maxActiveLeads: Number.isFinite(Number(body.maxActiveLeads)) ? Number(body.maxActiveLeads) : 3,
    });
    return NextResponse.json({ ok: true, agent, user: null });
  }

  if (body.action === "agent-status") {
    const agent = await updateSalesAgentProfile({
      agentId: String(body.agentId ?? ""),
      status: body.status === "ACTIVE" || body.status === "SUSPENDED" || body.status === "PENDING" ? body.status : undefined,
      groupId: typeof body.groupId === "string" && body.groupId ? body.groupId : undefined,
      parentAgentId: typeof body.parentAgentId === "string" ? body.parentAgentId || null : undefined,
      commissionPercent: Number.isFinite(Number(body.commissionPercent)) ? Number(body.commissionPercent) : undefined,
      canCreateSubAgents: typeof body.canCreateSubAgents === "boolean" ? body.canCreateSubAgents : undefined,
      canClaimLeads: typeof body.canClaimLeads === "boolean" ? body.canClaimLeads : undefined,
      maxActiveLeads: Number.isFinite(Number(body.maxActiveLeads)) ? Number(body.maxActiveLeads) : undefined,
    });
    return NextResponse.json({ ok: true, agent });
  }

  if (body.action === "mobile-device-status") {
    const deviceId = String(body.deviceId ?? "").trim();
    if (!deviceId) {
      return NextResponse.json({ ok: false, error: "Device ID is required." }, { status: 400 });
    }

    const currentDevice = await prisma.salesMobileDevice.findUnique({ where: { id: deviceId } });
    if (!currentDevice) {
      return NextResponse.json({ ok: false, error: "Mobile device not found." }, { status: 404 });
    }
    if (body.recordingEnabled === true && currentDevice.recordingCapability === "RECORDING_UNAVAILABLE") {
      return NextResponse.json({ ok: false, error: "Recording is unavailable on this company phone." }, { status: 400 });
    }

    const device = await prisma.salesMobileDevice.update({
      where: { id: deviceId },
      data: { isActive: body.isActive === true, recordingEnabled: body.recordingEnabled === true },
    });
    return NextResponse.json({ ok: true, device });
  }

  if (body.action === "reset-agent-password") {
    const result = await resetSalesAgentPasswordFromAdmin({
      agentId: String(body.agentId ?? ""),
      password: String(body.password ?? ""),
    });
    return result.ok ? NextResponse.json(result) : NextResponse.json(result, { status: 400 });
  }

  if (body.action === "group") {
    const group = await saveSalesGroup({
      id: typeof body.id === "string" && body.id ? body.id : undefined,
      name: String(body.name ?? ""),
      description: typeof body.description === "string" ? body.description : undefined,
      defaultCommissionPercent: Number(body.defaultCommissionPercent ?? 10),
      parentCommissionPercent: Number(body.parentCommissionPercent ?? 0),
      isActive: body.isActive !== false,
    });
    return NextResponse.json({ ok: true, group });
  }

  if (body.action === "announcement") {
    const announcement = await saveSalesAnnouncement({
      title: String(body.title ?? ""),
      body: String(body.body ?? ""),
      audience: typeof body.audience === "string" ? body.audience : "all",
      isActive: body.isActive !== false,
    });
    return NextResponse.json({ ok: true, announcement });
  }

  if (body.action === "lead-pool") {
    const lead = await createSalesLeadPoolItem({
      assignedAgentId: typeof body.assignedAgentId === "string" ? body.assignedAgentId : null,
      customerName: String(body.customerName ?? ""),
      customerPhone: String(body.customerPhone ?? ""),
      customerEmail: String(body.customerEmail ?? ""),
      source: String(body.source ?? "round_robin"),
      serviceInterest: String(body.serviceInterest ?? "Editor deal"),
      segment: String(body.segment ?? ""),
      priority: String(body.priority ?? "normal"),
      budgetAmount: Number(body.budgetAmount ?? 0),
      notes: String(body.notes ?? ""),
    });
    return NextResponse.json({ ok: true, lead });
  }

  if (body.action === "goal") {
    const goal = await saveSalesGoal({
      id: typeof body.id === "string" && body.id ? body.id : undefined,
      name: String(body.name ?? "Sales goal"),
      metric: String(body.metric ?? "PAID_REVENUE") as SalesGoalMetric,
      scope: String(body.scope ?? "INDIVIDUAL_AGENT") as SalesGoalScope,
      agentId: typeof body.agentId === "string" && body.agentId ? body.agentId : null,
      groupId: typeof body.groupId === "string" && body.groupId ? body.groupId : null,
      target: Number(body.target ?? 0),
      rewardText: typeof body.rewardText === "string" ? body.rewardText : "",
      startsAt: typeof body.startsAt === "string" ? body.startsAt : null,
      endsAt: typeof body.endsAt === "string" ? body.endsAt : null,
      isPinned: body.isPinned !== false,
      isActive: body.isActive !== false,
    });
    return NextResponse.json({ ok: true, goal });
  }

  if (body.action === "reward") {
    const reward = await saveSalesReward({
      id: typeof body.id === "string" && body.id ? body.id : undefined,
      title: String(body.title ?? ""),
      body: String(body.body ?? ""),
      agentId: typeof body.agentId === "string" && body.agentId ? body.agentId : null,
      groupId: typeof body.groupId === "string" && body.groupId ? body.groupId : null,
      isPinned: body.isPinned !== false,
      isActive: body.isActive !== false,
    });
    return NextResponse.json({ ok: true, reward });
  }

  if (body.action === "commission-rule") {
    const rule = await saveCommissionRule({
      name: String(body.name ?? "Sales commission rule"),
      type: String(body.type ?? "PERCENTAGE") as SalesCommissionRuleType,
      scope: String(body.scope ?? "ALL_AGENTS") as SalesCommissionScope,
      appliesTo: String(body.appliesTo ?? "ALL_PACKAGES") as SalesCommissionAppliesTo,
      groupId: typeof body.groupId === "string" && body.groupId ? body.groupId : null,
      agentId: typeof body.agentId === "string" && body.agentId ? body.agentId : null,
      packageId: typeof body.packageId === "string" && body.packageId ? body.packageId : null,
      serviceId: typeof body.serviceId === "string" && body.serviceId ? body.serviceId : null,
      value: Number(body.value ?? 0),
      parentCommissionPercent: Number.isFinite(Number(body.parentCommissionPercent)) ? Number(body.parentCommissionPercent) : null,
      minOrderValue: Number.isFinite(Number(body.minOrderValue)) ? Number(body.minOrderValue) : null,
      maxOrderValue: Number.isFinite(Number(body.maxOrderValue)) ? Number(body.maxOrderValue) : null,
      priority: Number(body.priority ?? 0),
      isActive: body.isActive !== false,
    });
    return NextResponse.json({ ok: true, rule });
  }

  if (body.action === "payout-status") {
    const payout = await updateSalesPayoutStatus({
      payoutId: String(body.payoutId ?? ""),
      status: String(body.status ?? "REQUESTED") as SalesPayoutStatus,
      note: typeof body.note === "string" ? body.note : undefined,
    });
    return payout ? NextResponse.json({ ok: true, payout }) : NextResponse.json({ ok: false, error: "Payout not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: false, error: "Unknown sales control action." }, { status: 400 });
}

export async function DELETE(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const result = await deleteSalesAgentFromAdmin({
    agentId: String(body?.agentId ?? ""),
  });
  return result.ok ? NextResponse.json(result) : NextResponse.json(result, { status: 400 });
}
