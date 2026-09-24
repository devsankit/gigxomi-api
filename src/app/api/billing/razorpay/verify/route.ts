import { NextResponse } from "next/server";
import { verifyBillingCheckoutIntent } from "@/lib/billing/checkout-intent";
import { activateSubscriptionFromRazorpay, verifyRazorpayPaymentSignature } from "@/lib/billing/razorpay-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      intent?: string;
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
      amountInRupees?: number;
    };

    if (!body?.intent || !body?.razorpay_order_id || !body?.razorpay_payment_id || !body?.razorpay_signature) {
      return NextResponse.json({ ok: false, error: "Missing required payment verification details." }, { status: 400 });
    }

    const intent = verifyBillingCheckoutIntent(body.intent);
    if (!intent) {
      return NextResponse.json({ ok: false, error: "Checkout session expired." }, { status: 400 });
    }

    const isValid = verifyRazorpayPaymentSignature({
      razorpay_order_id: body.razorpay_order_id,
      razorpay_payment_id: body.razorpay_payment_id,
      razorpay_signature: body.razorpay_signature,
    });

    if (!isValid) {
      return NextResponse.json({ ok: false, error: "Invalid payment signature verification." }, { status: 400 });
    }

    const result = await activateSubscriptionFromRazorpay({
      userId: intent.userId,
      packageId: intent.packageId,
      billingCycle: intent.billingCycle,
      razorpayOrderId: body.razorpay_order_id,
      razorpayPaymentId: body.razorpay_payment_id,
      amountInRupees: Number(body.amountInRupees) || (intent.billingCycle === "YEARLY" ? 17700 : 2000),
    });

    const redirectUrl = intent.returnTarget === "DIRECT_ANDROID" ? "gigxomi://mobile/billing-return?status=success" : "/mobile/billing-return?status=success";

    return NextResponse.json({ ok: true, redirectUrl, user: result.user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment verification failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
