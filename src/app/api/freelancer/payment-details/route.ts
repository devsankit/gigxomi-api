import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  getFreelancerWorkspaceState,
  upsertFreelancerPaymentDetails,
  type FreelancerMonetizationPlan,
} from "@/lib/gigxomi/freelancer-workspace-store";

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

  return NextResponse.json({
    ok: true,
    paymentDetails: workspace.paymentDetails,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Enter your payout details before saving." }, { status: 400 });
  }

  const bankAccountName = typeof body.bankAccountName === "string" ? body.bankAccountName.trim() : "";
  const bankAccountNumber = typeof body.bankAccountNumber === "string" ? body.bankAccountNumber.trim() : "";
  const bankIfsc = typeof body.bankIfsc === "string" ? body.bankIfsc.trim().toUpperCase() : "";
  const upiId = typeof body.upiId === "string" ? body.upiId.trim() : "";
  const monetizationPlan = typeof body.monetizationPlan === "string" ? body.monetizationPlan : "";
  const allowedPlans = new Set(["STANDARD_COMMISSION", "SUBSCRIPTION_MONTHLY", "SUBSCRIPTION_QUARTERLY", "SUBSCRIPTION_YEARLY"]);
  const hasAnyBankDetail = Boolean(bankAccountName || bankAccountNumber || bankIfsc);
  const hasCompleteBankDetails = Boolean(bankAccountName && bankAccountNumber && bankIfsc);

  if (!allowedPlans.has(monetizationPlan)) {
    return NextResponse.json({ error: "Choose a valid monetization plan." }, { status: 400 });
  }
  if (hasAnyBankDetail && !hasCompleteBankDetails) {
    return NextResponse.json({ error: "Complete the account holder, account number, and IFSC fields together." }, { status: 400 });
  }
  if (hasCompleteBankDetails && (bankAccountName.length < 2 || bankAccountName.length > 100)) {
    return NextResponse.json({ error: "Enter a valid account holder name." }, { status: 400 });
  }
  if (hasCompleteBankDetails && !/^[a-z0-9]{6,34}$/i.test(bankAccountNumber)) {
    return NextResponse.json({ error: "Enter a valid bank account number." }, { status: 400 });
  }
  if (hasCompleteBankDetails && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc)) {
    return NextResponse.json({ error: "Enter a valid 11-character IFSC code." }, { status: 400 });
  }
  if (upiId && !/^[a-z0-9._-]{2,}@[a-z0-9._-]{2,}$/i.test(upiId)) {
    return NextResponse.json({ error: "Enter a valid UPI ID, for example name@bank." }, { status: 400 });
  }
  if (!hasCompleteBankDetails && !upiId) {
    return NextResponse.json({ error: "Add either complete bank details or a valid UPI ID." }, { status: 400 });
  }

  const workspace = await upsertFreelancerPaymentDetails(
    authorization.session.userId,
    {
      userId: authorization.session.userId,
      displayName: authorization.session.displayName,
      email: authorization.session.email,
      phone: authorization.session.phone,
    },
    {
      bankAccountName,
      bankAccountNumber,
      bankIfsc,
      upiId,
      monetizationPlan: monetizationPlan as FreelancerMonetizationPlan,
    },
  );

  return NextResponse.json({
    ok: true,
    paymentDetails: workspace.paymentDetails,
  });
}
