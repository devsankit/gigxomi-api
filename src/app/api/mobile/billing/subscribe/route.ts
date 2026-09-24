import { NextResponse } from "next/server";

import { createStaleMobileSessionResponse, isMissingMobileSessionUserError, rejectMissingMobileSessionUser } from "@/lib/api/mobile-session-user";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { toMobileSession } from "@/lib/auth/mobile-session";
import { createSessionPayload } from "@/lib/auth/session";
import { createSessionToken } from "@/lib/auth/token";
import { isRegistrationPackageFree } from "@/lib/billing/package-billing";
import { activateFreeSubscription, getManagedUserForSession } from "@/lib/billing/subscription-service";
import { findRegistrationPackage } from "@/lib/gigxomi/public-growth-store";
import { companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";
import type { ManagedAuthUser } from "@/lib/auth/types";
import { createBillingCheckoutIntent } from "@/lib/billing/checkout-intent";
import { classifyPhonePeCheckoutError, phonePeMobileError } from "@/lib/billing/phonepe-checkout-errors";
import { recordPhonePeProviderDiagnostic } from "@/lib/billing/phonepe-admin-config-service";

type MobileSubscribeBody = {
  packageId?: unknown;
  billingCycle?: unknown;
  couponCode?: unknown;
  paymentMode?: unknown;
  upiVpa?: unknown;
  distributionChannel?: unknown;
};

function readBodyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL?.trim() || companyKnowledgeBase.siteUrl).replace(/\/+$/, "");
}

async function createMobileAuthPayload(user: ManagedAuthUser) {
  const session = createSessionPayload({
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
  const token = await createSessionToken(session);

  return {
    token,
    session: toMobileSession(session),
  };
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const staleSessionResponse = await rejectMissingMobileSessionUser(authorization.session.userId);
  if (staleSessionResponse) {
    return staleSessionResponse;
  }

  let body: MobileSubscribeBody;
  try {
    body = (await request.json()) as MobileSubscribeBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Send a valid JSON subscription body." }, { status: 400 });
  }

  const packageId = readBodyString(body.packageId);
  const billingCycle = body.billingCycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  const distributionChannel = body.distributionChannel === "PLAY_READER" ? "PLAY_READER" : "DIRECT";
  if (!packageId) {
    return NextResponse.json({ ok: false, error: "Choose a package to continue." }, { status: 400 });
  }

  const pkg = await findRegistrationPackage(packageId);
  if (!pkg || !pkg.isActive || pkg.allowRegistration === false) {
    return NextResponse.json({ ok: false, error: "That package is not available right now." }, { status: 404 });
  }

  const isFreelancerUpgradingToAgency =
    (authorization.session.packageAudience === "FREELANCER" || authorization.session.workspaceMode === "FREELANCER" || authorization.session.role === "FREELANCER") &&
    pkg.audience === "AGENCY";

  const expectedAudience =
    authorization.session.packageAudience === "AGENCY" || authorization.session.workspaceMode === "AGENCY" || authorization.session.role === "ADMIN"
      ? "AGENCY"
      : "FREELANCER";
  if (pkg.audience !== expectedAudience && !isFreelancerUpgradingToAgency) {
    return NextResponse.json(
      { ok: false, code: "PACKAGE_AUDIENCE_MISMATCH", error: `Choose a ${expectedAudience.toLowerCase()} package for this account.` },
      { status: 400 },
    );
  }

  if (isRegistrationPackageFree(pkg)) {
    try {
      const activated = await activateFreeSubscription(authorization.session.userId, pkg.id);
      const auth = await createMobileAuthPayload(activated.user);

      return NextResponse.json({
        ok: true,
        nextAction: pkg.audience === "AGENCY" ? "agency-profile" : "freelancer-profile",
        ...auth,
      });
    } catch (error) {
      if (isMissingMobileSessionUserError(error)) {
        return createStaleMobileSessionResponse();
      }
      const message = error instanceof Error ? error.message : "Unable to activate the free package.";
      return NextResponse.json(
        {
          ok: false,
          code: "PACKAGE_ACTIVATION_FAILED",
          error: message,
          actions: ["RETRY"],
        },
        { status: 400 },
      );
    }
  }

  if (distributionChannel === "PLAY_READER") {
    return NextResponse.json(
      {
        ok: false,
        code: "READER_PURCHASE_UNAVAILABLE",
        error: "Purchases are not available in this Play edition. Complete payment on the Gigxomi website, then refresh access here.",
        actions: ["REFRESH_ACCESS"],
      },
      { status: 409 },
    );
  }

  try {
    const checkoutIntent = createBillingCheckoutIntent({ userId: authorization.session.userId, packageId: pkg.id, billingCycle, returnTarget: "DIRECT_ANDROID" });
    const user = await getManagedUserForSession(authorization.session.userId);
    const auth = await createMobileAuthPayload(user);
    const paymentPath = `/subscription-checkout?intent=${encodeURIComponent(checkoutIntent)}`;
    const paymentUrl = `${getAppBaseUrl()}${paymentPath}`;

    return NextResponse.json({
      ok: true,
      nextAction: "payment",
      transactionId: null,
      paymentPath,
      paymentUrl,
      ...auth,
    });
  } catch (error) {
    if (isMissingMobileSessionUserError(error)) {
      return createStaleMobileSessionResponse();
    }
    const requestId = crypto.randomUUID();
    const classified = classifyPhonePeCheckoutError(error);
    const details = phonePeMobileError(classified);
    await recordPhonePeProviderDiagnostic({ status: classified.toUpperCase(), requestId }).catch(() => undefined);
    return NextResponse.json(
      {
        ok: false,
        code: details.code,
        error: details.error,
        retryable: details.retryable,
        actions: details.actions,
        requestId,
      },
      { status: details.status },
    );
  }
}
