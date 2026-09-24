import { createPublicRedirect } from "@/lib/auth/public-redirect";
import { applySessionCookie } from "@/lib/auth/session";
import { requirePaymentReferenceOwner } from "@/lib/billing/billing-route-authorization";
import { getManagedUserForSession } from "@/lib/billing/subscription-service";
import { verifyAutopaySetup } from "@/lib/billing/phonepe-status-service";
import { prisma } from "@/lib/prisma";
import { reconcileGatewayCheckout } from "@/lib/billing/gateway-checkout-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const merchantOrderId = url.searchParams.get("merchantOrderId") || "";
  if (!merchantOrderId) {
    return createPublicRedirect("/login", { error: "Subscription setup reference was missing. Please sign in and try again." });
  }

  const authorization = await requirePaymentReferenceOwner(merchantOrderId);
  // External browsers need not share the signed-in app session. Never create a login from a payment reference.
  if (!authorization.ok) return createPublicRedirect("/mobile/billing-return");

  try {
    const modern = await reconcileGatewayCheckout(merchantOrderId);
    if (modern) return createPublicRedirect("/mobile/billing-return");
  } catch {
    return createPublicRedirect("/mobile/billing-return");
  }

  const result = await verifyAutopaySetup(merchantOrderId);
  if (!result.user) {
    return createPublicRedirect("/login", { error: "Subscription mandate is not verified yet. Please wait a moment and try again." });
  }

  const payment = await prisma.paymentTransaction.findFirst({ where: { merchantOrderId }, select: { rawRequest: true } });
  const rawRequest = payment?.rawRequest && typeof payment.rawRequest === "object" && !Array.isArray(payment.rawRequest) ? payment.rawRequest as Record<string, unknown> : {};
  const user = await getManagedUserForSession(result.user.id);
  const redirectTo = rawRequest.returnTarget === "DIRECT_ANDROID"
    ? "gigxomi://mobile/billing-return"
    : user.packageAudience === "AGENCY" ? "/admin?onboarding=required" : "/freelancer/onboarding";
  const response = createPublicRedirect(redirectTo);
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
