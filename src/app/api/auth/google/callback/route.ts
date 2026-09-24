import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  exchangeGoogleCodeForTokens,
  fetchGoogleUserInfo,
  getGoogleOAuthConfig,
  parseOAuthState,
} from "@/lib/auth/google-oauth";
import { prisma } from "@/lib/prisma";
import { applySessionCookie } from "@/lib/auth/session";
import type { AppRole, PackageAudience, PackageStatus, WorkspaceMode } from "@/lib/auth/types";

const LOCAL_FALLBACK_FILE = path.join(process.cwd(), ".gigxomi", "local-auth-users.json");

async function getLocalUsers(): Promise<any[]> {
  try {
    const data = await readFile(LOCAL_FALLBACK_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveLocalUser(user: any) {
  try {
    await mkdir(path.dirname(LOCAL_FALLBACK_FILE), { recursive: true });
    const current = await getLocalUsers();
    current.push(user);
    await writeFile(LOCAL_FALLBACK_FILE, JSON.stringify(current, null, 2), "utf8");
  } catch (err) {
    console.error("[Google OAuth] Error writing fallback user file", err);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "app.gigxomi.com";
  const proto = request.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const baseOrigin = `${proto}://${host}`;

  const fallbackRedirect = "/signup";

  if (oauthError) {
    return NextResponse.redirect(new URL(`${fallbackRedirect}?error=Google+sign-in+was+cancelled`, baseOrigin));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL(`${fallbackRedirect}?error=Missing+Google+authorization+code`, baseOrigin));
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get("gx_google_oauth_state")?.value;
  const savedVerifier = cookieStore.get("gx_google_oauth_verifier")?.value;

  if (!savedState || !savedVerifier || savedState !== state) {
    return NextResponse.redirect(
      new URL(`${fallbackRedirect}?error=Invalid+or+expired+OAuth+session.+Please+try+again.`, baseOrigin)
    );
  }

  const config = getGoogleOAuthConfig();
  if (!config) {
    return NextResponse.redirect(
      new URL(`${fallbackRedirect}?error=Google+OAuth+is+not+configured+on+this+server.`, baseOrigin)
    );
  }

  let userInfo;
  try {
    const tokens = await exchangeGoogleCodeForTokens(code, savedVerifier, config);
    userInfo = await fetchGoogleUserInfo(tokens.access_token);
  } catch (error) {
    console.error("[Google OAuth] Token exchange or userinfo failed", error);
    return NextResponse.redirect(
      new URL(`${fallbackRedirect}?error=Failed+to+verify+Google+account.+Please+try+again.`, baseOrigin)
    );
  }

  if (!userInfo.email || !userInfo.email_verified) {
    return NextResponse.redirect(
      new URL(`${fallbackRedirect}?error=Google+account+email+is+not+verified.`, baseOrigin)
    );
  }

  const normalizedEmail = userInfo.email.trim().toLowerCase();
  const parsedState = parseOAuthState(state);
  const selectedRoleParam = parsedState?.role || "agency";
  const requestedAudience: PackageAudience = selectedRoleParam === "freelancer" ? "FREELANCER" : "AGENCY";
  const targetRole: AppRole = requestedAudience === "AGENCY" ? "ADMIN" : "FREELANCER";
  const workspaceMode: WorkspaceMode = requestedAudience;

  // Find user by verified email only
  let user = null;
  try {
    user = await prisma.appAuthUser.findFirst({
      where: { email: normalizedEmail },
    });
  } catch {
    const localUsers = await getLocalUsers();
    user = localUsers.find((u) => u.email === normalizedEmail) ?? null;
  }

  if (user) {
    // Existing user found by verified email. Verify identity alignment.
    const userRole = user.role as AppRole;
    const userAudience = (user.packageAudience as PackageAudience) || (userRole === "FREELANCER" ? "FREELANCER" : "AGENCY");

    // Existing registered users navigate directly to their active role workspace
    let destination = "/admin";
    if (parsedState?.redirectTo && parsedState.redirectTo.startsWith("/") && !parsedState.redirectTo.startsWith("//")) {
      destination = parsedState.redirectTo;
    } else if (userRole === "ADMIN" || userAudience === "AGENCY") {
      destination = "/admin";
    } else if (userRole === "FREELANCER" || userAudience === "FREELANCER") {
      destination = "/freelancer";
    } else if (userRole === "SUPER_ADMIN") {
      destination = "/super-admin";
    } else if (userRole === "MANAGER") {
      destination = "/manager";
    }

    const response = NextResponse.redirect(new URL(destination, baseOrigin));

    await applySessionCookie(response, {
      userId: user.id,
      role: userRole,
      assignedRole: user.assignedRole as AppRole,
      tenantId: user.tenantId,
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      packageId: user.packageId,
      packageName: user.packageName,
      packageAudience: userAudience,
      packageStatus: user.packageStatus as PackageStatus,
      packageExpiresAt: user.packageExpiresAt ? (typeof user.packageExpiresAt === 'string' ? user.packageExpiresAt : user.packageExpiresAt.toISOString()) : null,
      workspaceMode: (user.workspaceMode as WorkspaceMode) || (userAudience === "AGENCY" ? "AGENCY" : "FREELANCER"),
    });

    response.cookies.delete("gx_google_oauth_state");
    response.cookies.delete("gx_google_oauth_verifier");

    return response;
  }

  // Create new user with verified email
  const generatedId = `user-${targetRole.toLowerCase()}-${randomBytes(4).toString("hex")}`;
  const tenantId = requestedAudience === "AGENCY" ? `tenant-agency-${randomBytes(4).toString("hex")}` : "tenant-gigxomi";
  const defaultPackageId = requestedAudience === "AGENCY" ? "pkg-agency-freemium" : "pkg-freelancer-starter";
  const defaultPackageName = requestedAudience === "AGENCY" ? "Agency" : "Freelancer Starter";
  const displayName = userInfo.name || (userInfo.given_name ? `${userInfo.given_name} ${userInfo.family_name || ""}`.trim() : "Gigxomi User");
  const placeholderPhone = `+google-${randomBytes(6).toString("hex")}`;
  const salt = randomBytes(16).toString("hex");

  const newUserData = {
    id: generatedId,
    role: targetRole,
    assignedRole: targetRole,
    tenantId,
    displayName,
    email: normalizedEmail,
    phone: placeholderPhone,
    loginPhoneAliases: [],
    packageId: defaultPackageId,
    packageName: defaultPackageName,
    packageAudience: requestedAudience,
    packageStatus: "ACTIVE" as const,
    packageExpiresAt:
      requestedAudience === "AGENCY"
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
    workspaceMode,
    passwordSalt: salt,
    passwordHash: "",
    otpCode: "904290",
    permissions: [targetRole.toLowerCase()],
    isSeeded: false,
  };

  try {
    user = await prisma.appAuthUser.create({
      data: newUserData,
    });
  } catch (createError) {
    console.warn("[Google OAuth] Prisma database offline, saving to fallback store");
    await saveLocalUser(newUserData);
    user = newUserData;
  }

  const targetUrl = new URL(
    `/signup?step=onboarding&role=${requestedAudience === "FREELANCER" ? "freelancer" : "agency"}&authenticated=1`,
    baseOrigin
  );
  const response = NextResponse.redirect(targetUrl.toString());

  await applySessionCookie(response, {
    userId: user.id,
    role: targetRole,
    assignedRole: targetRole,
    tenantId: user.tenantId,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    packageId: user.packageId,
    packageName: user.packageName,
    packageAudience: requestedAudience,
    packageStatus: "ACTIVE",
    workspaceMode,
  });

  response.cookies.set("gx_onboarding", "1", {
    path: "/",
    sameSite: "lax",
    maxAge: 86400,
  });
  response.cookies.delete("gx_google_oauth_state");
  response.cookies.delete("gx_google_oauth_verifier");

  return response;
}
