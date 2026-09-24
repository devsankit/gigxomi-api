import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  addLedgerAdjustment,
  addManualDirectPayout,
  getPayoutAccountingState,
  updatePayoutRequestNote,
  updatePayoutRequestStatus,
  type PayoutRequestStatus,
} from "@/lib/gigxomi/admin-payout-accounting-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const state = await getPayoutAccountingState(authorization.session.tenantId);
  const paidRequests = state.payoutRequests.filter((r) => r.status === "PAID");
  const pendingRequests = state.payoutRequests.filter(
    (r) => r.status === "REQUESTED" || r.status === "UNDER_REVIEW" || r.status === "APPROVED"
  );

  const paidVolume = paidRequests.reduce((sum, r) => sum + r.netAmount, 0);
  const pendingVolume = pendingRequests.reduce((sum, r) => sum + r.netAmount, 0);
  const grossVolume = state.payoutRequests.reduce((sum, r) => sum + r.grossAmount, 0);
  const agencyMargin = state.payoutRequests.reduce((sum, r) => sum + r.agencyFee, 0);

  const totalCredits = state.ledgerAdjustments
    .filter((a) => a.type === "CREDIT")
    .reduce((sum, a) => sum + a.amount, 0);
  const totalDebits = state.ledgerAdjustments
    .filter((a) => a.type === "DEBIT")
    .reduce((sum, a) => sum + a.amount, 0);
  const netAdjustments = totalCredits - totalDebits;

  return NextResponse.json({
    ok: true,
    payoutRequests: state.payoutRequests,
    ledgerAdjustments: state.ledgerAdjustments,
    editors: state.editors,
    metrics: {
      totalRequests: state.payoutRequests.length,
      paidVolume,
      pendingVolume,
      grossVolume,
      agencyMargin,
      totalCredits,
      totalDebits,
      netAdjustments,
    },
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  if (action === "ADD_ADJUSTMENT") {
    const editorId = typeof body.editorId === "string" ? body.editorId.trim() : "";
    const type = body.type === "DEBIT" ? "DEBIT" : "CREDIT";
    const amount = Number(body.amount);
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (!editorId) {
      return NextResponse.json({ error: "Select an editor for this adjustment." }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Enter a valid positive adjustment amount in ₹." }, { status: 400 });
    }

    const createdBy = authorization.session.displayName || "Admin";
    const adjustment = await addLedgerAdjustment({
      editorId,
      type,
      amount,
      category,
      note,
      createdBy,
    });

    return NextResponse.json({ ok: true, adjustment });
  }

  if (action === "RECORD_DIRECT_PAYOUT") {
    const editorId = typeof body.editorId === "string" ? body.editorId.trim() : "";
    const amount = Number(body.amount);
    const category = typeof body.category === "string" ? body.category.trim() : "Offline Direct Settlement";
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (!editorId) {
      return NextResponse.json({ error: "Select an editor for this direct payout." }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Enter a valid positive payout amount in ₹." }, { status: 400 });
    }

    const createdBy = authorization.session.displayName || "Admin";
    const payout = await addManualDirectPayout({
      editorId,
      amount,
      category,
      note,
      createdBy,
      tenantId: authorization.session.tenantId,
    });

    return NextResponse.json({ ok: true, payoutRequest: payout });
  }

  if (action === "UPDATE_STATUS") {
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const status = typeof body.status === "string" ? (body.status as PayoutRequestStatus) : null;
    const note = typeof body.note === "string" ? body.note : undefined;

    if (!id || !status) {
      return NextResponse.json({ error: "Request ID and status are required." }, { status: 400 });
    }

    const updated = await updatePayoutRequestStatus(id, status, note, authorization.session.tenantId);
    if (!updated) {
      return NextResponse.json({ error: "Payout request not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, payoutRequest: updated });
  }

  if (action === "UPDATE_NOTE") {
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const note = typeof body.note === "string" ? body.note : "";

    if (!id) {
      return NextResponse.json({ error: "Request ID is required." }, { status: 400 });
    }

    const updated = await updatePayoutRequestNote(id, note, authorization.session.tenantId);
    if (!updated) {
      return NextResponse.json({ error: "Payout request not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, payoutRequest: updated });
  }

  return NextResponse.json({ error: "Unknown action specified." }, { status: 400 });
}
