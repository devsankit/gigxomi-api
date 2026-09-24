import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";

export type PayoutRequestStatus = "REQUESTED" | "UNDER_REVIEW" | "APPROVED" | "PAID" | "REJECTED";

export type PayoutRequestRecord = {
  id: string;
  editorId: string;
  editorName: string;
  editorEmail: string;
  editorPhone: string;
  editorUpiId: string;
  projectTitle: string;
  conversationId: string | null;
  grossAmount: number;
  agencyFee: number;
  netAmount: number;
  status: PayoutRequestStatus;
  note: string;
  createdAt: string;
  paidAt: string | null;
};

export type LedgerAdjustmentRecord = {
  id: string;
  editorId: string;
  editorName: string;
  type: "CREDIT" | "DEBIT";
  amount: number;
  category: string;
  note: string;
  createdAt: string;
  createdBy: string;
};

export type AgencyEditorSummary = {
  id: string;
  name: string;
  role: string;
  upiId: string;
};

export type PayoutAccountingState = {
  payoutRequests: PayoutRequestRecord[];
  ledgerAdjustments: LedgerAdjustmentRecord[];
  editors: AgencyEditorSummary[];
};

type DiskOverrides = {
  ledgerAdjustments: LedgerAdjustmentRecord[];
  statusOverrides: Record<
    string,
    {
      status: PayoutRequestStatus;
      paidAt?: string | null;
      note?: string;
    }
  >;
  manualPayouts?: PayoutRequestRecord[];
};

function getStoragePath(tenantId?: string | null): string {
  const cleanTenant = typeof tenantId === "string" ? tenantId.trim().replace(/[^a-zA-Z0-9_-]/g, "") : "";
  if (cleanTenant) {
    return path.join(process.cwd(), ".gigxomi-storage", `admin-payout-accounting-${cleanTenant}.json`);
  }
  return path.join(process.cwd(), ".gigxomi-storage", "admin-payout-accounting.json");
}

async function loadOverridesFromDisk(tenantId?: string | null): Promise<DiskOverrides> {
  const filePath = getStoragePath(tenantId);
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const ledgerAdjustments = Array.isArray(parsed.ledgerAdjustments)
      ? (parsed.ledgerAdjustments as LedgerAdjustmentRecord[])
      : [];
    const statusOverrides =
      parsed.statusOverrides && typeof parsed.statusOverrides === "object"
        ? (parsed.statusOverrides as Record<string, { status: PayoutRequestStatus; paidAt?: string | null; note?: string }>)
        : {};
    const manualPayouts = Array.isArray(parsed.manualPayouts)
      ? (parsed.manualPayouts as PayoutRequestRecord[])
      : [];
    return { ledgerAdjustments, statusOverrides, manualPayouts };
  } catch {
    return { ledgerAdjustments: [], statusOverrides: {}, manualPayouts: [] };
  }
}

async function saveOverridesToDisk(overrides: DiskOverrides, tenantId?: string | null): Promise<void> {
  const filePath = getStoragePath(tenantId);
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(overrides, null, 2), "utf-8");
  } catch {}
}

export async function getPayoutAccountingState(tenantId?: string | null): Promise<PayoutAccountingState> {
  const cleanTenant = typeof tenantId === "string" ? tenantId.trim() : null;
  const overrides = await loadOverridesFromDisk(cleanTenant);

  // 1. Fetch real editors from PostgreSQL (scoped by agency team membership if tenantId is provided)
  let teamFreelancerIds: Set<string> | null = null;
  if (cleanTenant) {
    const memberships = await prisma.appTeamMembership.findMany({
      where: { tenantId: cleanTenant, status: "ACTIVE" },
      select: { freelancerId: true },
    });
    teamFreelancerIds = new Set(memberships.map((m) => m.freelancerId));
  }

  const workspaces = await prisma.appFreelancerWorkspace.findMany({
    where: teamFreelancerIds ? { userId: { in: Array.from(teamFreelancerIds) } } : undefined,
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
          phone: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const editors: AgencyEditorSummary[] = workspaces
    .map((ws) => {
      const profile = (ws.profile && typeof ws.profile === "object" ? ws.profile : {}) as Record<string, unknown>;
      const payment = (ws.paymentDetails && typeof ws.paymentDetails === "object" ? ws.paymentDetails : {}) as Record<string, unknown>;

      const name =
        (typeof profile.fullName === "string" && profile.fullName.trim()) ||
        (typeof profile.displayName === "string" && profile.displayName.trim()) ||
        ws.user?.displayName?.trim() ||
        "Editor";

      const role =
        (typeof profile.profession === "string" && profile.profession.trim()) ||
        (typeof profile.specialty === "string" && profile.specialty.trim()) ||
        "Video Editor";

      const phone =
        (typeof profile.phone === "string" && profile.phone.trim()) ||
        ws.user?.phone?.trim() ||
        "";

      const cleanPhone = phone.replace(/\D/g, "");
      const upiId =
        (typeof payment.upiId === "string" && payment.upiId.trim()) ||
        (cleanPhone ? `${cleanPhone}@upi` : "editor@upi");

      return {
        id: ws.userId,
        name,
        role,
        upiId,
      };
    })
    .filter((e) => e.name !== "Editor" && e.name.length > 1);

  // 2. Fetch real conversations and assignments (scoped to tenant)
  const [conversations, assignments] = await Promise.all([
    prisma.appConversation.findMany({
      where: {
        ...(cleanTenant ? { tenantId: cleanTenant } : {}),
        customerName: { not: "" },
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.appAssignmentRecord.findMany({
      where: cleanTenant ? { tenantId: cleanTenant } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);

  // Editor lookup map for fast association
  const editorByName = new Map<string, AgencyEditorSummary>();
  const editorById = new Map<string, AgencyEditorSummary>();
  for (const ed of editors) {
    editorByName.set(ed.name.toLowerCase().trim(), ed);
    editorById.set(ed.id, ed);
  }

  // 3. Build payout requests from real database entities
  const payoutRequests: PayoutRequestRecord[] = [];
  const seenIds = new Set<string>();

  // A) From real editor workspace payout requests (requested from wallet/dashboard)
  for (const ws of workspaces) {
    const wsPayouts = Array.isArray(ws.payoutRequests) ? (ws.payoutRequests as Array<Record<string, unknown>>) : [];
    for (const pr of wsPayouts) {
      if (!pr || typeof pr !== "object") continue;
      const pId = typeof pr.id === "string" && pr.id.trim() ? pr.id.trim() : `payout-ws-${ws.userId}`;
      if (seenIds.has(pId)) continue;
      seenIds.add(pId);

      const amount = Number(pr.amount || 0);
      const matchedEditor = editorById.get(ws.userId);
      const prStatus = String(pr.status || "REQUESTED").toUpperCase();
      const validStatus: PayoutRequestStatus =
        prStatus === "PAID"
          ? "PAID"
          : prStatus === "APPROVED"
          ? "APPROVED"
          : prStatus === "UNDER_REVIEW"
          ? "UNDER_REVIEW"
          : prStatus === "REJECTED"
          ? "REJECTED"
          : "REQUESTED";

      payoutRequests.push({
        id: pId,
        editorId: ws.userId,
        editorName: matchedEditor?.name ?? ws.user?.displayName ?? "Team Editor",
        editorEmail: ws.user?.email ?? "editor@gigxomi.work",
        editorPhone: ws.user?.phone ?? "",
        editorUpiId: matchedEditor?.upiId ?? "editor@upi",
        projectTitle: (typeof pr.note === "string" && pr.note.trim()) || "Editor Wallet Payout",
        conversationId: null,
        grossAmount: amount,
        agencyFee: 0,
        netAmount: amount,
        status: validStatus,
        note: (typeof pr.note === "string" && pr.note.trim()) || "Payout requested by editor from wallet balance.",
        createdAt: (typeof pr.createdAt === "string" && pr.createdAt) || ws.updatedAt.toISOString(),
        paidAt: validStatus === "PAID" ? ws.updatedAt.toISOString() : null,
      });
    }
  }

  // B) From real internal lane chat payout requests (where editor requested payment from agency)
  for (const conv of conversations) {
    const payload = (conv.payload && typeof conv.payload === "object" ? conv.payload : {}) as Record<string, unknown>;
    const pRequests = Array.isArray(payload.paymentRequests) ? (payload.paymentRequests as Array<Record<string, unknown>>) : [];
    for (const pr of pRequests) {
      if (!pr || typeof pr !== "object") continue;
      // Only include requests where the editor is the payee receiving funds from the agency
      if (pr.payeeRole !== "freelancer") continue;

      const pId = typeof pr.id === "string" && pr.id.trim() ? pr.id.trim() : `payout-chat-${conv.id}`;
      if (seenIds.has(pId)) continue;
      seenIds.add(pId);

      const amount = Number(pr.amount || 0);
      const matchedEditor =
        (conv.assignedFreelancerId ? editorById.get(conv.assignedFreelancerId) : null) ||
        (conv.assignedFreelancerName ? editorByName.get(conv.assignedFreelancerName.toLowerCase().trim()) : null);

      const statusMap: Record<string, PayoutRequestStatus> = {
        Paid: "PAID",
        Sent: "REQUESTED",
        Draft: "UNDER_REVIEW",
        Viewed: "UNDER_REVIEW",
        Failed: "REJECTED",
        Cancelled: "REJECTED",
      };

      const rawStatus = String(pr.status || "Sent");
      const mappedStatus: PayoutRequestStatus = statusMap[rawStatus] || "REQUESTED";

      payoutRequests.push({
        id: pId,
        editorId: matchedEditor?.id ?? conv.assignedFreelancerId ?? "editor",
        editorName: (typeof pr.payeeName === "string" && pr.payeeName) || (matchedEditor?.name ?? conv.assignedFreelancerName ?? "Team Editor"),
        editorEmail: "editor@gigxomi.work",
        editorPhone: "+91 99933 28124",
        editorUpiId: (typeof pr.upiId === "string" && pr.upiId) || (matchedEditor?.upiId ?? "editor@upi"),
        projectTitle: `${conv.customerName} - ${(typeof pr.title === "string" && pr.title) || "Editor Payout Request"}`,
        conversationId: conv.id,
        grossAmount: amount,
        agencyFee: 0,
        netAmount: amount,
        status: mappedStatus,
        note: (typeof pr.note === "string" && pr.note) || `Payout requested by editor in internal chat for ${conv.customerName}.`,
        createdAt: (typeof pr.createdAt === "string" && pr.createdAt) || conv.updatedAt.toISOString(),
        paidAt: mappedStatus === "PAID" ? conv.updatedAt.toISOString() : null,
      });
    }
  }

  // C) From completed assignment records
  for (const assignment of assignments) {
    if (assignment.status !== "COMPLETED") continue;
    const pId = `payout-assign-${assignment.id}`;
    if (seenIds.has(pId)) continue;
    seenIds.add(pId);

    const gross = assignment.budgetAmount ? Number(assignment.budgetAmount) : 5000;
    const fee = Math.round(gross * 0.2);
    const net = gross - fee;

    const matchedEditor =
      editorById.get(assignment.freelancerId) ||
      (assignment.freelancerName ? editorByName.get(assignment.freelancerName.toLowerCase().trim()) : null) ||
      editors[0];

    payoutRequests.push({
      id: pId,
      editorId: matchedEditor?.id ?? assignment.freelancerId,
      editorName: matchedEditor?.name ?? assignment.freelancerName ?? "Team Editor",
      editorEmail: "editor@gigxomi.work",
      editorPhone: "+91 99933 28124",
      editorUpiId: matchedEditor?.upiId ?? "editor@upi",
      projectTitle: `${assignment.title || "Client Project"} - Assignment #${assignment.id.slice(-6)}`,
      conversationId: null,
      grossAmount: gross,
      agencyFee: fee,
      netAmount: net,
      status: "PAID",
      note: assignment.notes || "Project milestone delivered according to brief.",
      createdAt: assignment.createdAt.toISOString(),
      paidAt: assignment.updatedAt.toISOString(),
    });
  }

  // 4. Apply status overrides and note edits from disk
  for (const pr of payoutRequests) {
    const override = overrides.statusOverrides[pr.id];
    if (override) {
      pr.status = override.status;
      if (override.paidAt !== undefined) pr.paidAt = override.paidAt;
      if (override.note !== undefined) pr.note = override.note;
    }
  }

  return {
    payoutRequests: [...(overrides.manualPayouts || []), ...payoutRequests],
    ledgerAdjustments: overrides.ledgerAdjustments,
    editors,
  };
}

export async function addLedgerAdjustment(input: {
  editorId: string;
  type: "CREDIT" | "DEBIT";
  amount: number;
  category: string;
  note: string;
  createdBy: string;
  tenantId?: string | null;
}): Promise<LedgerAdjustmentRecord> {
  const overrides = await loadOverridesFromDisk(input.tenantId);

  let editorName = "Team Editor";
  try {
    const ws = await prisma.appFreelancerWorkspace.findUnique({
      where: { userId: input.editorId },
      include: { user: true },
    });
    if (ws) {
      const profile = (ws.profile && typeof ws.profile === "object" ? ws.profile : {}) as Record<string, unknown>;
      editorName =
        (typeof profile.fullName === "string" && profile.fullName.trim()) ||
        (typeof profile.displayName === "string" && profile.displayName.trim()) ||
        ws.user?.displayName ||
        "Team Editor";
    }
  } catch {}

  const adjustment: LedgerAdjustmentRecord = {
    id: `adj-${Date.now()}`,
    editorId: input.editorId,
    editorName,
    type: input.type,
    amount: Math.abs(Number(input.amount)),
    category: input.category.trim() || (input.type === "CREDIT" ? "Manual Credit" : "Manual Deduction"),
    note: input.note.trim(),
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy || "Admin",
  };

  overrides.ledgerAdjustments = [adjustment, ...overrides.ledgerAdjustments];
  await saveOverridesToDisk(overrides, input.tenantId);
  return adjustment;
}

export async function updatePayoutRequestStatus(
  id: string,
  status: PayoutRequestStatus,
  note?: string,
  tenantId?: string | null
): Promise<PayoutRequestRecord | null> {
  const overrides = await loadOverridesFromDisk(tenantId);

  const existingOverride = overrides.statusOverrides[id] || { status };
  existingOverride.status = status;
  if (status === "PAID" && !existingOverride.paidAt) {
    existingOverride.paidAt = new Date().toISOString();
  }
  if (note !== undefined) {
    existingOverride.note = note.trim();
  }

  overrides.statusOverrides[id] = existingOverride;
  await saveOverridesToDisk(overrides, tenantId);

  const state = await getPayoutAccountingState(tenantId);
  return state.payoutRequests.find((r) => r.id === id) ?? null;
}

export async function updatePayoutRequestNote(
  id: string,
  note: string,
  tenantId?: string | null
): Promise<PayoutRequestRecord | null> {
  const overrides = await loadOverridesFromDisk(tenantId);

  const existingOverride = overrides.statusOverrides[id] || { status: "REQUESTED" };
  existingOverride.note = note.trim();

  overrides.statusOverrides[id] = existingOverride;
  await saveOverridesToDisk(overrides, tenantId);

  const state = await getPayoutAccountingState(tenantId);
  return state.payoutRequests.find((r) => r.id === id) ?? null;
}

export async function addManualDirectPayout(input: {
  editorId: string;
  amount: number;
  category: string;
  note: string;
  createdBy: string;
  tenantId?: string | null;
}): Promise<PayoutRequestRecord> {
  const overrides = await loadOverridesFromDisk(input.tenantId);

  let editorName = "Team Editor";
  let editorUpiId = "editor@upi";
  let editorPhone = "+91 99933 28124";
  let editorEmail = "editor@gigxomi.work";

  try {
    const ws = await prisma.appFreelancerWorkspace.findUnique({
      where: { userId: input.editorId },
      include: { user: true },
    });
    if (ws) {
      const profile = (ws.profile && typeof ws.profile === "object" ? ws.profile : {}) as Record<string, unknown>;
      editorName =
        (typeof profile.fullName === "string" && profile.fullName.trim()) ||
        (typeof profile.displayName === "string" && profile.displayName.trim()) ||
        ws.user?.displayName ||
        "Team Editor";
      if (typeof profile.upiId === "string" && profile.upiId.trim()) {
        editorUpiId = profile.upiId.trim();
      }
      if (ws.user?.email) editorEmail = ws.user.email;
      if (ws.user?.phoneNumber) editorPhone = ws.user.phoneNumber;
    }
  } catch {}

  const now = new Date().toISOString();
  const directPayout: PayoutRequestRecord = {
    id: `payout-direct-${Date.now()}`,
    editorId: input.editorId,
    editorName,
    editorEmail,
    editorPhone,
    editorUpiId,
    projectTitle: input.category || "Offline Direct Settlement",
    conversationId: null,
    grossAmount: Math.abs(Number(input.amount)),
    agencyFee: 0,
    netAmount: Math.abs(Number(input.amount)),
    status: "PAID",
    note: input.note ? `${input.note} (Recorded by ${input.createdBy})` : `Direct payout via ${input.category} (Recorded by ${input.createdBy})`,
    createdAt: now,
    paidAt: now,
  };

  overrides.manualPayouts = [directPayout, ...(overrides.manualPayouts || [])];
  await saveOverridesToDisk(overrides, input.tenantId);
  return directPayout;
}
