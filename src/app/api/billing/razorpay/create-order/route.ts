import { NextResponse } from "next/server";
import { verifyBillingCheckoutIntent } from "@/lib/billing/checkout-intent";
import { createRazorpayOrder } from "@/lib/billing/razorpay-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { intent?: string; couponCode?: string };
    if (!body?.intent) {
      return NextResponse.json({ ok: false, error: "Missing checkout intent." }, { status: 400 });
    }

    const intent = verifyBillingCheckoutIntent(body.intent);
    if (!intent) {
      return NextResponse.json({ ok: false, error: "Checkout session expired. Please refresh the page." }, { status: 400 });
    }

    const order = await createRazorpayOrder({
      userId: intent.userId,
      packageId: intent.packageId,
      billingCycle: intent.billingCycle,
      couponCode: body.couponCode || intent.couponCode,
    });

    return NextResponse.json({ ok: true, order });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initiate Razorpay order.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
