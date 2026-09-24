import { applySessionCookie, getSessionContext } from "@/lib/auth/session";
import { getPublicAuthIntentById } from "@/lib/auth/public-auth-intent-store";
import { createPublicRedirect, sanitizePublicAuthError } from "@/lib/auth/public-redirect";
import { activateFreeSubscription, getManagedUserForSession } from "@/lib/billing/subscription-service";
import { isRegistrationPackageFree } from "@/lib/billing/package-billing";
import { findRegistrationPackage } from "@/lib/gigxomi/public-growth-store";
import { prisma } from "@/lib/prisma";
import { createBillingCheckoutIntent } from "@/lib/billing/checkout-intent";

function redirectWithError(message: string, packageId?: string, intentId?: string) {
  return createPublicRedirect("/pricing", {
    error: message,
    packageId,
    intentId,
  });
}

async function applyBillingSession(response: ReturnType<typeof createPublicRedirect>, userId: string) {
  const user = await getManagedUserForSession(userId);
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
}

async function safeApplyBillingSession(response: ReturnType<typeof createPublicRedirect>, userId: string) {
  try {
    await applyBillingSession(response, userId);
  } catch (error) {
    console.error("[billing] Billing session refresh failed", {
      userId,
      error: error instanceof Error ? error.message : "Unknown billing session error",
    });
  }
}

async function findPendingPhonePeRedirect(input: {
  intentId?: string;
  packageId: string;
  userId?: string | null;
  userPhone?: string | null;
}) {
  void input.intentId;
  void input.userPhone;

  try {
    if (input.userId) {
      const pendingPayment = await prisma.paymentTransaction.findFirst({
        where: {
          userId: input.userId,
          packageId: input.packageId,
          provider: "PHONEPE",
          status: { in: ["PENDING", "INITIATED"] },
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, provider: true, redirectUrl: true, createdAt: true },
      });

      if (pendingPayment) {
        const phonePeRedirectUrl = pendingPayment.redirectUrl?.trim() ?? "";
        const isFreshPhonePeUrl = pendingPayment.createdAt.getTime() > Date.now() - 18 * 60 * 1000;
        if (phonePeRedirectUrl && isFreshPhonePeUrl) {
          return phonePeRedirectUrl;
        }
      }
    }
  } catch (error) {
    console.error("[billing] Pending PhonePe lookup failed", {
      packageId: input.packageId,
      userId: input.userId ?? null,
      error: error instanceof Error ? error.message : "Unknown pending payment lookup error",
    });
  }

  return null;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const packageId = String(formData.get("packageId") ?? "").trim();
  const intentId = String(formData.get("intentId") ?? "").trim();
  const explicitReferralCode = String(formData.get("ref") ?? "").trim();
  const billingCycle = formData.get("billingCycle") === "YEARLY" ? "YEARLY" : "MONTHLY";
  const session = await getSessionContext();

  if (!packageId) {
    return redirectWithError("Choose a package to continue.", undefined, intentId);
  }

  const resumeIntent = intentId ? await getPublicAuthIntentById(intentId) : null;
  const canResumeVerifiedSignup =
    resumeIntent?.flow === "SIGNUP" &&
    Boolean(resumeIntent.userId) &&
    (resumeIntent.status === "PENDING_SUBSCRIPTION" || resumeIntent.status === "VERIFIED");
  const userId = session.userId ?? (canResumeVerifiedSignup ? resumeIntent?.userId ?? null : null);

  if (!userId) {
    return createPublicRedirect("/signup", { packageId });
  }

  if (session.role === "SUPER_ADMIN") {
    return createPublicRedirect("/super-admin");
  }

  try {
    const pkg = await findRegistrationPackage(packageId);
    if (!pkg || !pkg.isActive || pkg.allowRegistration === false) {
      return redirectWithError("That package is not available right now. Please choose another package.", packageId, intentId);
    }

    const billingUser = await prisma.appAuthUser.findUnique({ where: { id: userId }, select: { packageAudience: true, workspaceMode: true, role: true } });
    const expectedAudience =
      billingUser?.packageAudience === "AGENCY" || billingUser?.workspaceMode === "AGENCY" || billingUser?.role === "ADMIN"
        ? "AGENCY"
        : "FREELANCER";
    if (pkg.audience !== expectedAudience) {
      return redirectWithError(`Choose a ${expectedAudience.toLowerCase()} package for this account.`, packageId, intentId);
    }

    if (isRegistrationPackageFree(pkg)) {
      const activated = await activateFreeSubscription(userId, pkg.id);
      const redirectTo = activated.user.packageAudience === "AGENCY" ? "/admin?onboarding=required" : "/freelancer/onboarding";
      const response = createPublicRedirect(redirectTo);
      await safeApplyBillingSession(response, activated.user.id);
      return response;
    }

    const checkoutIntent = createBillingCheckoutIntent({ userId, packageId: pkg.id, billingCycle, returnTarget: "WEB", couponCode: explicitReferralCode || resumeIntent?.salesReferralCode || undefined });
    const response = createPublicRedirect(`/subscription-checkout?intent=${encodeURIComponent(checkoutIntent)}`);
    await safeApplyBillingSession(response, userId);
    return response;
  } catch (error) {
    console.error("Package subscription start failed", error);
    if (userId) {
      const pendingPhonePeRedirect = await findPendingPhonePeRedirect({
        intentId: resumeIntent?.id,
        packageId,
        userId,
        userPhone: session.phone ?? resumeIntent?.phone ?? null,
      });
      if (pendingPhonePeRedirect) {
        const response = createPublicRedirect(pendingPhonePeRedirect);
        await safeApplyBillingSession(response, userId);
        return response;
      }
    }
    return redirectWithError(sanitizePublicAuthError(error, "We could not open the PhonePe payment page right now. Please try again in a moment."), packageId, intentId);
  }
}
