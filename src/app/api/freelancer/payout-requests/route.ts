import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listWalletCreditsForEditorFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { createFreelancerPayoutRequest, getFreelancerWorkspaceState } from "@/lib/gigxomi/freelancer-workspace-store";

const outstandingPayoutStatuses = new Set(["REQUESTED", "UNDER_REVIEW", "APPROVED"]);

async function getPayoutAvailability(userId: string, workspace: Awaited<ReturnType<typeof getFreelancerWorkspaceState>>) {
  const credits = await listWalletCreditsForEditorFromFile(userId);
  const walletAvailable = credits
    .filter((credit) => credit.status === "Available")
    .reduce((sum, credit) => sum + credit.editorAmount, 0);
  const outstanding = workspace.payoutRequests
    .filter((payout) => outstandingPayoutStatuses.has(payout.status))
    .reduce((sum, payout) => sum + payout.amount, 0);

  return {
    walletAvailable,
    outstanding,
    availableToRequest: Math.max(0, walletAvailable - outstanding),
  };
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const workspace = await getFreelancerWorkspaceState(authorization.session.userId, {
    userId: authorization.session.userId,
    displayName: authorization.session.displayName,
    email: authorization.session.email,
    phone: authorization.session.phone,
  });
  const availability = await getPayoutAvailability(authorization.session.userId, workspace);

  return NextResponse.json({
    ok: true,
    payoutRequests: workspace.payoutRequests,
    ...availability,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Enter a payout amount before submitting." }, { status: 400 });
  }

  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amount)) {
    return NextResponse.json({ error: "Enter a payout amount greater than zero in whole rupees." }, { status: 400 });
  }
  if (note.length > 300) {
    return NextResponse.json({ error: "Keep the payout note under 300 characters." }, { status: 400 });
  }

  const workspace = await getFreelancerWorkspaceState(authorization.session.userId, {
    userId: authorization.session.userId,
    displayName: authorization.session.displayName,
    email: authorization.session.email,
    phone: authorization.session.phone,
  });
  const hasUpi = /^[a-z0-9._-]{2,}@[a-z0-9._-]{2,}$/i.test(workspace.paymentDetails.upiId);
  const hasBank = Boolean(workspace.paymentDetails.bankAccountName && workspace.paymentDetails.bankAccountNumber && workspace.paymentDetails.bankIfsc);
  if (!hasUpi && !hasBank) {
    return NextResponse.json({ error: "Save valid bank or UPI details before requesting a payout." }, { status: 400 });
  }

  const availability = await getPayoutAvailability(authorization.session.userId, workspace);
  if (amount > availability.availableToRequest) {
    return NextResponse.json(
      { error: `You can request up to INR ${availability.availableToRequest.toLocaleString("en-IN")} right now.` },
      { status: 400 },
    );
  }

  const result = await createFreelancerPayoutRequest(
    authorization.session.userId,
    {
      userId: authorization.session.userId,
      displayName: authorization.session.displayName,
      email: authorization.session.email,
      phone: authorization.session.phone,
    },
    {
      amount,
      note,
    },
  );

  return NextResponse.json({
    ok: true,
    payoutRequest: result.payoutRequest,
    payoutRequests: result.workspace.payoutRequests,
    ...availability,
    outstanding: availability.outstanding + amount,
    availableToRequest: Math.max(0, availability.availableToRequest - amount),
  });
}
