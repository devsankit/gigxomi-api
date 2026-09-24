import { NextResponse } from "next/server";
import { activateSubscriptionFromRazorpay, verifyRazorpayWebhookSignature } from "@/lib/billing/razorpay-service";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature") || "";

    if (process.env.RAZORPAY_WEBHOOK_SECRET) {
      const isValid = verifyRazorpayWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.warn("[RAZORPAY_WEBHOOK] Invalid webhook signature received.");
        return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
      }
    }

    const event = JSON.parse(rawBody) as {
      event: string;
      payload?: {
        payment?: { entity?: { id: string; order_id: string; amount: number; notes?: Record<string, string> } };
        order?: { entity?: { id: string; amount: number; notes?: Record<string, string> } };
      };
    };

    console.log(`[RAZORPAY_WEBHOOK] Received event: ${event.event}`);

    if (event.event === "payment.captured" || event.event === "order.paid") {
      const paymentEntity = event.payload?.payment?.entity;
      const orderEntity = event.payload?.order?.entity;

      const notes = paymentEntity?.notes || orderEntity?.notes || {};
      const userId = notes.userId;
      const packageId = notes.packageId || "pkg-agency-launch";
      const billingCycle = (notes.billingCycle === "YEARLY" ? "YEARLY" : "MONTHLY") as "MONTHLY" | "YEARLY";
      const orderId = paymentEntity?.order_id || orderEntity?.id || `ord_${Date.now()}`;
      const paymentId = paymentEntity?.id || `pay_${Date.now()}`;
      const amountInRupees = ((paymentEntity?.amount || orderEntity?.amount || 200000) / 100);

      if (userId) {
        await activateSubscriptionFromRazorpay({
          userId,
          packageId,
          billingCycle,
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          amountInRupees,
        });
      }
    }

    return NextResponse.json({ ok: true, received: true });
  } catch (error) {
    console.error("[RAZORPAY_WEBHOOK] Error handling webhook:", error);
    return NextResponse.json({ ok: false, error: "Internal webhook error" }, { status: 500 });
  }
}
