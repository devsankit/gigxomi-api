import { NextResponse } from "next/server";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { applySessionCookie } from "@/lib/auth/session";
import type { AppRole, PackageAudience, WorkspaceMode } from "@/lib/auth/types";
import { validatePublicDisplayName } from "@/lib/auth/public-display-name";

const LOCAL_FALLBACK_FILE = path.join(process.cwd(), ".gigxomi", "local-auth-users.json");

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

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
    console.error("[Email Signup] Error writing fallback user file", err);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid JSON request payload." }, { status: 400 });
    }

    const rawRole = String(body.role ?? "AGENCY").toUpperCase();
    const audience: PackageAudience = rawRole === "FREELANCER" ? "FREELANCER" : "AGENCY";
    const targetRole: AppRole = audience === "AGENCY" ? "ADMIN" : "FREELANCER";
    const workspaceMode: WorkspaceMode = audience;

    const rawDisplayName = String(body.displayName ?? "").trim();
    const rawEmail = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!rawDisplayName) {
      return NextResponse.json({ ok: false, error: "Please enter your full name." }, { status: 400 });
    }

    const displayNameValidation = validatePublicDisplayName(rawDisplayName);
    if (!displayNameValidation.ok) {
      return NextResponse.json({ ok: false, error: displayNameValidation.error }, { status: 400 });
    }

    if (!rawEmail || !rawEmail.includes("@") || !rawEmail.includes(".")) {
      return NextResponse.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 8 characters long." },
        { status: 400 }
      );
    }

    // Check if user already exists with this email (Prisma with local fallback)
    let existing = null;
    try {
      existing = await prisma.appAuthUser.findFirst({
        where: { email: rawEmail },
      });
    } catch (dbError) {
      console.warn("[Email Signup] Database offline, checking fallback store");
      const localUsers = await getLocalUsers();
      existing = localUsers.find((u) => u.email === rawEmail) ?? null;
    }

    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          error: "An account with this email already exists. Please sign in instead.",
        },
        { status: 409 }
      );
    }

    const salt = randomBytes(16).toString("hex");
    const hashedPassword = hashPassword(password, salt);
    const userId = `user-${targetRole.toLowerCase()}-${randomBytes(4).toString("hex")}`;
    const tenantId = audience === "AGENCY" ? `tenant-agency-${randomBytes(4).toString("hex")}` : "tenant-gigxomi";
    const packageId = audience === "AGENCY" ? "pkg-agency-freemium" : "pkg-freelancer-starter";
    const packageName = audience === "AGENCY" ? "Agency" : "Freelancer Starter";
    const placeholderPhone = `+email-${randomBytes(6).toString("hex")}`;

    const userPayload = {
      id: userId,
      role: targetRole,
      assignedRole: targetRole,
      tenantId,
      displayName: displayNameValidation.value,
      email: rawEmail,
      phone: placeholderPhone,
      loginPhoneAliases: [],
      packageId,
      packageName,
      packageAudience: audience,
      packageStatus: "ACTIVE" as const,
      packageExpiresAt:
        audience === "AGENCY"
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          : new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
      workspaceMode,
      passwordSalt: salt,
      passwordHash: hashedPassword,
      otpCode: "904290",
      permissions: [targetRole.toLowerCase()],
      isSeeded: false,
    };

    let createdUser: {
      id: string;
      displayName: string;
      email: string | null;
      phone: string;
      role: string;
      tenantId: string | null;
      packageId: string | null;
      packageName: string | null;
      packageAudience?: string | null;
      packageStatus?: string | null;
      workspaceMode?: string | null;
    } = userPayload;
    try {
      createdUser = await prisma.appAuthUser.create({
        data: userPayload,
      });
    } catch (dbError) {
      console.warn("[Email Signup] Database offline, saving to fallback store");
      await saveLocalUser(userPayload);
    }

    const response = NextResponse.json({
      ok: true,
      user: {
        id: createdUser.id,
        displayName: createdUser.displayName,
        email: createdUser.email,
        role: targetRole,
        audience,
      },
    });

    response.cookies.set("gx_onboarding", "1", {
      path: "/",
      sameSite: "lax",
      maxAge: 86400,
    });

    await applySessionCookie(response, {
      userId: createdUser.id,
      role: targetRole,
      assignedRole: targetRole,
      tenantId: createdUser.tenantId,
      displayName: createdUser.displayName,
      email: createdUser.email,
      phone: createdUser.phone,
      packageId: createdUser.packageId,
      packageName: createdUser.packageName,
      packageAudience: audience,
      packageStatus: "ACTIVE",
      workspaceMode,
    });

    return response;
  } catch (error) {
    console.error("[Email Signup] Error creating user", error);
    return NextResponse.json(
      {
        ok: false,
        error: "We could not complete registration right now. Please try again.",
      },
      { status: 500 }
    );
  }
}
