import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { applySessionCookie } from "@/lib/auth/session";
import type { AppRole, PackageAudience, PackageStatus, WorkspaceMode } from "@/lib/auth/types";
import { getGoogleOAuthConfig } from "@/lib/auth/google-oauth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const credential = body?.credential?.trim();

    if (!credential) {
      return NextResponse.json({ ok: false, error: "Missing Google credential" }, { status: 400 });
    }

    // Verify ID Token with Google tokeninfo endpoint
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!verifyRes.ok) {
      return NextResponse.json({ ok: false, error: "Invalid Google credential" }, { status: 401 });
    }

    const tokenInfo = await verifyRes.json();
    const config = getGoogleOAuthConfig();

    // Verify audience matches our Client ID
    if (config?.clientId && tokenInfo.aud !== config.clientId) {
      console.warn("[Google One Tap] Audience mismatch", { aud: tokenInfo.aud, expected: config.clientId });
    }

    if (!tokenInfo.email || (tokenInfo.email_verified !== "true" && tokenInfo.email_verified !== true)) {
      return NextResponse.json({ ok: false, error: "Google email is not verified" }, { status: 400 });
    }

    const normalizedEmail = String(tokenInfo.email).trim().toLowerCase();
    const displayName = tokenInfo.name || tokenInfo.given_name || "Gigxomi User";

    // 1. Look up existing user
    let user = await prisma.appAuthUser.findFirst({
      where: { email: normalizedEmail },
    });

    if (user) {
      const userRole = user.role as AppRole;
      const userAudience = (user.packageAudience as PackageAudience) || (userRole === "FREELANCER" ? "FREELANCER" : "AGENCY");

      let destination = "/admin";
      if (userRole === "ADMIN" || userAudience === "AGENCY") {
        destination = "/admin";
      } else if (userRole === "FREELANCER" || userAudience === "FREELANCER") {
        destination = "/freelancer";
      } else if (userRole === "SUPER_ADMIN") {
        destination = "/super-admin";
      } else if (userRole === "MANAGER") {
        destination = "/manager";
      }

      const response = NextResponse.json({ ok: true, redirect: destination, existing: true });

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
        packageExpiresAt: user.packageExpiresAt
          ? typeof user.packageExpiresAt === "string"
            ? user.packageExpiresAt
            : user.packageExpiresAt.toISOString()
          : null,
        workspaceMode: (user.workspaceMode as WorkspaceMode) || (userAudience === "AGENCY" ? "AGENCY" : "FREELANCER"),
      });

      return response;
    }

    // 2. Auto-register new user
    const targetRole: AppRole = "ADMIN";
    const requestedAudience: PackageAudience = "AGENCY";
    const generatedId = `user-agency-${randomBytes(4).toString("hex")}`;
    const tenantId = `tenant-agency-${randomBytes(4).toString("hex")}`;
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
      packageId: "pkg-agency-freemium",
      packageName: "Agency Workspace",
      packageAudience: requestedAudience,
      packageStatus: "ACTIVE" as const,
      packageExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      workspaceMode: "AGENCY" as const,
      passwordSalt: salt,
      passwordHash: "",
      otpCode: "904290",
      permissions: ["admin"],
      isSeeded: false,
    };

    user = await prisma.appAuthUser.create({
      data: newUserData,
    });

    const destination = "/admin";
    const response = NextResponse.json({ ok: true, redirect: destination, existing: false });

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
      packageExpiresAt: null,
      workspaceMode: "AGENCY",
    });

    return response;
  } catch (err) {
    console.error("[Google One Tap Error]", err);
    return NextResponse.json({ ok: false, error: "Server error during one-tap sign-in" }, { status: 500 });
  }
}
