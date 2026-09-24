import { NextResponse } from "next/server";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { getSessionContext, applySessionCookie } from "@/lib/auth/session";
import { normalizePhone } from "@/lib/auth/normalize";
import { prisma } from "@/lib/prisma";
import { ensureAgencyListingForTenantFromFile } from "@/lib/gigxomi/agency-listing-store";
import { ensureWhatsAppConnectionDraftFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { ensureFreelancerWorkspace } from "@/lib/gigxomi/freelancer-workspace-store";

const LOCAL_FALLBACK_FILE = path.join(process.cwd(), ".gigxomi", "local-auth-users.json");

async function getLocalUsers(): Promise<any[]> {
  try {
    const data = await readFile(LOCAL_FALLBACK_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function updateLocalUserPhone(userId: string, email: string, phone: string) {
  try {
    await mkdir(path.dirname(LOCAL_FALLBACK_FILE), { recursive: true });
    const current = await getLocalUsers();
    let updated = false;
    for (const u of current) {
      if (u.id === userId || (email && u.email?.toLowerCase() === email.toLowerCase())) {
        u.phone = phone;
        u.loginPhoneAliases = Array.from(new Set([...(u.loginPhoneAliases ?? []), phone]));
        updated = true;
      }
    }
    if (updated) {
      await writeFile(LOCAL_FALLBACK_FILE, JSON.stringify(current, null, 2), "utf8");
    }
  } catch (err) {
    console.error("[update-phone] Error updating fallback user phone", err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (session.role === "GUEST" || !session.userId) {
      return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
    }

    const rawPhone = String(body.phone ?? "").trim();
    if (!rawPhone) {
      return NextResponse.json({ ok: false, error: "Please enter your WhatsApp number." }, { status: 400 });
    }

    const normalized = normalizePhone(rawPhone);
    const digitsOnly = normalized.replace(/[^\d]/g, "");
    if (!normalized || digitsOnly.length < 8 || digitsOnly.length > 15) {
      return NextResponse.json(
        { ok: false, error: "Please enter a valid WhatsApp number with country code." },
        { status: 400 }
      );
    }

    const rawAgencyName = String(body.agencyName ?? "").trim();
    const effectiveDisplayName = rawAgencyName || session.displayName || "User";

    // Update in Prisma if database is online
    try {
      const existingUserWithPhone = await prisma.appAuthUser.findUnique({
        where: { phone: normalized },
        select: { id: true },
      });
      if (existingUserWithPhone && existingUserWithPhone.id !== session.userId) {
        return NextResponse.json(
          {
            ok: false,
            error: "This WhatsApp number is already associated with another account. Please use a different number or log in.",
          },
          { status: 409 }
        );
      }

      await prisma.appAuthUser.update({
        where: { id: session.userId },
        data: {
          phone: normalized,
          loginPhoneAliases: { push: normalized },
          ...(rawAgencyName ? { displayName: rawAgencyName } : {}),
        },
      });
    } catch (dbErr: any) {
      if (dbErr?.code === "P2002") {
        return NextResponse.json(
          {
            ok: false,
            error: "This WhatsApp number is already associated with another account.",
          },
          { status: 409 }
        );
      }
      // Prisma offline, update fallback store
      await updateLocalUserPhone(session.userId, session.email ?? "", normalized);
    }

    // Ensure tenant stores have the updated phone number
    if (session.workspaceMode === "AGENCY" && session.tenantId) {
      try {
        await ensureAgencyListingForTenantFromFile({
          tenantId: session.tenantId,
          publicName: effectiveDisplayName,
          ownerName: effectiveDisplayName,
          whatsappNumber: normalized,
          contactEmail: session.email,
        });
        await ensureWhatsAppConnectionDraftFromFile({
          tenantId: session.tenantId,
          businessName: effectiveDisplayName,
          displayName: effectiveDisplayName,
          phoneNumber: normalized,
        });
      } catch (agencyError) {
        console.warn("[update-phone] Error updating agency stores with new phone:", agencyError);
      }
    } else if (session.workspaceMode === "FREELANCER") {
      try {
        await ensureFreelancerWorkspace(session.userId, {
          userId: session.userId,
          displayName: effectiveDisplayName,
          email: session.email,
          phone: normalized,
        });
      } catch (freelancerError) {
        console.warn("[update-phone] Error updating freelancer workspace with new phone:", freelancerError);
      }
    }

    const response = NextResponse.json({
      ok: true,
      phone: normalized,
      agencyName: effectiveDisplayName,
      message: "WhatsApp number updated successfully.",
    });

    // Refresh session cookie with the new verified phone number and agency name
    await applySessionCookie(response, {
      userId: session.userId,
      role: (session.role as string) === "GUEST" ? "ADMIN" : session.role,
      assignedRole: session.assignedRole ?? ((session.role as string) === "GUEST" ? "ADMIN" : session.role),
      tenantId: session.tenantId,
      displayName: effectiveDisplayName,
      email: session.email,
      phone: normalized,
      packageId: session.packageId,
      packageName: session.packageName,
      packageAudience: session.packageAudience,
      packageStatus: session.packageStatus ?? "ACTIVE",
      packageExpiresAt: session.packageExpiresAt,
      workspaceMode: session.workspaceMode ?? "AGENCY",
    });

    return response;
  } catch (error) {
    console.error("[update-phone] Error processing phone update:", error);
    return NextResponse.json({ ok: false, error: "Internal server error." }, { status: 500 });
  }
}
