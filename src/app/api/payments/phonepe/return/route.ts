import { createPublicRedirect } from "@/lib/auth/public-redirect";
import { applySessionCookie } from "@/lib/auth/session";
import { requirePaymentReferenceOwner } from "@/lib/billing/billing-route-authorization";
import { getDashboardRedirectForUser, getManagedUserForSession } from "@/lib/billing/subscription-service";
import { verifyOneTimePayment } from "@/lib/billing/phonepe-status-service";
import { reconcileGatewayCheckout } from "@/lib/billing/gateway-checkout-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const merchantTransactionId = url.searchParams.get("merchantTransactionId") || url.searchParams.get("merchantOrderId") || "";
  if (!merchantTransactionId) {
    return createPublicRedirect("/login", { error: "Payment reference was missing. Please sign in and try again." });
  }

  const authorization = await requirePaymentReferenceOwner(merchantTransactionId);
  // External app browsers need not share the app session. Do not mint a login from an order reference.
  if (!authorization.ok) return createPublicRedirect("/mobile/billing-return");

  try {
    const modern = await reconcileGatewayCheckout(merchantTransactionId);
    if (modern) return createPublicRedirect("/mobile/billing-return");
  } catch {
    return createPublicRedirect("/mobile/billing-return");
  }

  const result = await verifyOneTimePayment(merchantTransactionId);
  if (!result.user) {
    return createPublicRedirect("/login", { error: "Payment is not verified yet. Please wait a moment and try again." });
  }

  const redirectTo = await getDashboardRedirectForUser(result.user.id);
  const response = createPublicRedirect(redirectTo);
  const user = await getManagedUserForSession(result.user.id);
  await applySessionCookie(response, {
    userId: user.id,
    role: user.role,
    assignedRole: user.assignedRole,
    tenantId: user.tenantId,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    packageId: user.packageId,
    packageName: user.packageName,
    packageAudience: user.packageAudience,
    packageStatus: user.packageStatus,
    packageExpiresAt: user.packageExpiresAt,
    workspaceMode: user.workspaceMode,
  });
  return response;
}
