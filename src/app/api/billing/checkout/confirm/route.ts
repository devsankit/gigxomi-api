import { NextResponse } from "next/server";
import { verifyBillingCheckoutIntent } from "@/lib/billing/checkout-intent";
import { classifyPhonePeCheckoutError } from "@/lib/billing/phonepe-checkout-errors";
import { recordPhonePeProviderDiagnostic } from "@/lib/billing/phonepe-admin-config-service";
import { reconcileGatewayCheckout, startGatewayCheckout } from "@/lib/billing/gateway-checkout-service";
import { prisma } from "@/lib/prisma";

function checkoutRedirect(request: Request, intent: string, code: string, requestId: string) {
  const target = new URL("/subscription-checkout", request.url);
  if (intent) target.searchParams.set("intent", intent);
  target.searchParams.set("checkoutError", code);
  target.searchParams.set("checkoutRequestId", requestId);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let signedIntent = "";
  try {
    const form = await request.formData();
    signedIntent = String(form.get("intent") ?? "");
    const intent = verifyBillingCheckoutIntent(signedIntent);
    if (!intent) return NextResponse.redirect(new URL("/subscription-checkout?checkoutError=session-expired", request.url), 303);
    if (form.get("action") === "status") {
      const pending = await prisma.paymentTransaction.findMany({ where: { userId: intent.userId, provider: "PHONEPE", status: { in: ["PENDING", "INITIATED"] } }, take: 5 });
      const results = [];
      for (const payment of pending) if (payment.merchantOrderId) results.push(await reconcileGatewayCheckout(payment.merchantOrderId));
      const waiting = results.some((result) => !result || ["PENDING", "INITIATED"].includes(result.status));
      return checkoutRedirect(request, signedIntent, waiting ? "payment-pending" : "checkout-failed", requestId);
    }
    const kind = form.get("paymentKind") === "ONE_TIME" ? "ONE_TIME" : "AUTOPAY";
    const paymentMode = form.get("paymentMode") === "UPI_COLLECT" ? "UPI_COLLECT" : "UPI_INTENT";
    const upiVpa = String(form.get("upiVpa") ?? "").trim();
    if (kind === "AUTOPAY" && paymentMode === "UPI_COLLECT" && !/^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$/i.test(upiVpa)) {
      return checkoutRedirect(request, signedIntent, "invalid-vpa", requestId);
    }
    const payment = await startGatewayCheckout({ intent, kind, requestId, paymentMode, upiVpa,
      couponCode: String(form.get("couponCode") ?? intent.couponCode ?? "").trim() });
    if (!payment.redirectUrl || payment.status === "SUCCESS") return checkoutRedirect(request, signedIntent, "payment-pending", requestId);
    const response = NextResponse.redirect(payment.redirectUrl, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    const code = classifyPhonePeCheckoutError(error);
    console.error("[billing][phonepe-checkout]", { requestId, code });
    await recordPhonePeProviderDiagnostic({ status: code.toUpperCase(), requestId }).catch(() => undefined);
    return checkoutRedirect(request, signedIntent, code, requestId);
  }
}
