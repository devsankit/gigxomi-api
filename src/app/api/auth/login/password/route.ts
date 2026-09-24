import { createPublicRedirect, sanitizePublicAuthError } from "@/lib/auth/public-redirect";
import { SUPER_ADMIN_HOME_ROUTE, SUPER_ADMIN_LOGIN_ROUTE } from "@/lib/auth/super-admin-config";
import { authenticatePassword, findUserRecord } from "@/lib/auth/store";
import { applySessionCookie, getDashboardPathForIdentity, getDefaultDashboardPath, getSafeRedirectPath } from "@/lib/auth/session";
import { ensureFreelancerOnboarding, isFreelancerOnboardingEnabled } from "@/lib/gigxomi/freelancer-onboarding-service";
import { getSalesAgentAccess } from "@/lib/gigxomi/sales-store";

import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const acceptsJson = request.headers.get("accept")?.includes("application/json") || false;
  const isJsonClient = contentType.includes("application/json") || acceptsJson;

  let identifier = "";
  let password = "";
  let redirectTo = "";
  let rawLoginScope = "";

  if (contentType.includes("application/json")) {
    const json = await request.json().catch(() => ({}));
    identifier = String(json.identifier ?? "").trim();
    password = String(json.password ?? "").trim();
    redirectTo = String(json.redirectTo ?? "").trim();
    rawLoginScope = String(json.loginScope ?? json.source ?? "").trim();
  } else {
    const formData = await request.formData().catch(() => new FormData());
    identifier = String(formData.get("identifier") ?? "").trim();
    password = String(formData.get("password") ?? "").trim();
    redirectTo = String(formData.get("redirectTo") ?? "").trim();
    rawLoginScope = String(formData.get("loginScope") ?? "").trim();
  }

  const loginScope = rawLoginScope === "super-admin" || rawLoginScope === "manager" || rawLoginScope === "sales" ? rawLoginScope : "public";
  const loginPath = loginScope === "super-admin" ? SUPER_ADMIN_LOGIN_ROUTE : loginScope === "manager" ? "/manager-login" : loginScope === "sales" ? "/sales/login" : "/login";

  function respondFail(errorMsg: string, status = 400, extraParams: Record<string, string | null | undefined> = {}) {
    if (isJsonClient) {
      return NextResponse.json({ ok: false, error: errorMsg }, { status });
    }
    return createPublicRedirect(loginPath, { ...extraParams, error: errorMsg });
  }

  if (!identifier || !password) {
    return respondFail("Identifier and password are required.");
  }

  const userRecord = await findUserRecord(identifier);
  const resolvedUser = userRecord?.managed ?? null;
  if (!resolvedUser) {
    const error =
      loginScope === "manager"
        ? "No manager account matches that email or WhatsApp number. Please check your credentials."
        : "No account matches that email or phone number. Check your credentials and try again.";
    return respondFail(error, 404, { identifier });
  }

  if (resolvedUser.role === "SUPER_ADMIN" && loginScope !== "super-admin") {
    return respondFail("Use the dedicated super-admin login page for the owner account.", 403, { identifier });
  }

  if (loginScope === "super-admin" && resolvedUser.role !== "SUPER_ADMIN") {
    return respondFail("Only the authorized super-admin account can sign in here.", 403);
  }

  if (loginScope === "manager" && resolvedUser.role !== "MANAGER") {
    return respondFail("This account is not registered as an agency manager. Please use general login.", 403);
  }

  if (resolvedUser.role === "MANAGER" && userRecord?.raw.permissions?.includes("manager_status:paused")) {
    return respondFail("This manager account has been paused by the agency administrator.", 403);
  }

  if (loginScope === "sales" && resolvedUser.role !== "SALES_AGENT") {
    return respondFail("Only approved sales accounts can sign in here.", 403);
  }

  try {
    const user = await authenticatePassword(identifier, password);
    if (!user) {
      return respondFail(
        loginScope === "manager"
          ? "Incorrect manager PIN or password. Please check your credentials and try again."
          : "Password login failed. Check your credentials and try again.",
        401,
        { identifier }
      );
    }
    if (loginScope === "sales") {
      const access = await getSalesAgentAccess(user.id);
      if (!access.ok) {
        const error =
          access.reason === "PENDING"
            ? "Your sales account is waiting for super-admin approval."
            : access.reason === "SUSPENDED"
              ? "Your sales account is suspended. Contact Gigxomi support."
              : "Your sales profile was not found. Request sales access again or contact super-admin.";
        return respondFail(error, 403);
      }
    }

    const freelancerOnboardingRequired = user.role === "FREELANCER" && isFreelancerOnboardingEnabled()
      ? !(await ensureFreelancerOnboarding({
          userId: user.id,
          role: user.role,
          displayName: user.displayName,
          email: user.email,
          phone: user.phone,
        })).completed
      : false;
    const destination = freelancerOnboardingRequired
      ? "/freelancer/onboarding"
      : loginScope === "super-admin"
        ? redirectTo.trim()
          ? getSafeRedirectPath(redirectTo, user.role)
          : SUPER_ADMIN_HOME_ROUTE
        : loginScope === "manager"
          ? redirectTo.trim()
            ? getSafeRedirectPath(redirectTo, user.role)
            : "/manager/chat"
        : loginScope === "sales"
          ? redirectTo.trim()
            ? getSafeRedirectPath(redirectTo, user.role)
            : "/sales"
        : redirectTo.trim()
          ? getSafeRedirectPath(redirectTo, user.role)
          : getDashboardPathForIdentity({
              role: user.role,
              packageAudience: user.packageAudience,
              workspaceMode: user.workspaceMode,
            });
    const destinationPath = destination || getDefaultDashboardPath(user.role);
    const response = isJsonClient
      ? NextResponse.json({
          ok: true,
          user: {
            id: user.id,
            role: user.role,
            assignedRole: user.assignedRole,
            tenantId: user.tenantId,
            displayName: user.displayName,
            email: user.email,
            phone: user.phone,
          },
          redirectUrl: destinationPath,
        })
      : createPublicRedirect(destinationPath);

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
  } catch (error) {
    console.error("Password login failed", error);
    const errorMsg = sanitizePublicAuthError(error, "We could not sign you in right now. Please try again in a moment.");
    return respondFail(errorMsg, 500);
  }
}
