import { createPublicRedirect } from "@/lib/auth/public-redirect";
import { verifyGappPayment } from "@/lib/gigxomi/gapp-webinar-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const merchantTransactionId = url.searchParams.get("merchantTransactionId") || url.searchParams.get("merchantOrderId") || "";
  if (!merchantTransactionId) {
    return createPublicRedirect("/webinar", { payment: "missing" });
  }

  try {
    const result = await verifyGappPayment(merchantTransactionId);
    if (result.status === "SUCCESS") {
      return createPublicRedirect(`/webinar/thank-you/${result.registrationId}`);
    }

    return createPublicRedirect(`/webinar/thank-you/${result.registrationId}`, { payment: "pending" });
  } catch (error) {
    console.error("[gapp] PhonePe return verification failed", error);
    return createPublicRedirect("/webinar", { payment: "failed" });
  }
}
