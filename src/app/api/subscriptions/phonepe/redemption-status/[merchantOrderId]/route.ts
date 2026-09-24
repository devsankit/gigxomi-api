import { NextResponse } from "next/server";

import { requirePaymentReferenceOwner } from "@/lib/billing/billing-route-authorization";
import { PhonePeMandateAutopayProvider } from "@/lib/billing/phonepe-providers";

export async function GET(_: Request, context: { params: Promise<{ merchantOrderId: string }> }) {
  const { merchantOrderId } = await context.params;
  const authorization = await requirePaymentReferenceOwner(merchantOrderId);
  if (!authorization.ok) return authorization.response;

  const provider = new PhonePeMandateAutopayProvider();
  const result = await provider.getRedemptionStatus(merchantOrderId);
  return NextResponse.json({ ok: true, result: { state: result.state, providerReference: result.providerReference ?? null } });
}
