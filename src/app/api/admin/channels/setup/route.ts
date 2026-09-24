import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import {
  ensureWhatsAppConnectionDraftFromFile,
  updateWhatsAppConnectionStateFromFile,
  updateInstagramConnectionStateFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { getAgencyListingByTenantIdFromFile, updateAgencyListingFromFile } from "@/lib/gigxomi/agency-listing-store";
import { normalizePhone } from "@/lib/auth/normalize";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (session.role === "GUEST" || !session.userId) {
      return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const tenantId = resolveSessionTenantId(session, body?.tenantId);
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Missing tenant context." }, { status: 400 });
    }

    const rawWhatsApp = String(body?.whatsappNumber ?? "").trim();
    const rawInstagram = String(body?.instagramHandle ?? "").trim().replace(/^@/, "");

    const normalizedWhatsApp = rawWhatsApp ? normalizePhone(rawWhatsApp) : "";

    // 1. Setup WhatsApp connection
    if (normalizedWhatsApp) {
      await ensureWhatsAppConnectionDraftFromFile({
        tenantId,
        businessName: session.displayName ?? "Agency",
        displayName: session.displayName ?? "Agency",
        phoneNumber: normalizedWhatsApp,
      });
      await updateWhatsAppConnectionStateFromFile(tenantId, {
        phoneNumber: normalizedWhatsApp,
        businessName: session.displayName ?? "Agency",
        pluginEnabled: true,
        status: "Onboarding in progress",
        note: "Phone number registered during setup. Meta WhatsApp Cloud API configuration pending.",
      });
      const existingListing = await getAgencyListingByTenantIdFromFile(tenantId).catch(() => null);
      if (existingListing) {
        await updateAgencyListingFromFile(tenantId, {
          ...existingListing,
          showcaseEditorIds: existingListing.showcaseEditors?.map((e) => e.editorId) ?? [],
          whatsappNumber: normalizedWhatsApp,
        });
      }
    }

    // 2. Setup Instagram connection
    if (rawInstagram) {
      await updateInstagramConnectionStateFromFile(tenantId, {
        username: rawInstagram,
        displayName: session.displayName ?? rawInstagram,
        pluginEnabled: true,
        status: "Plugin enabled",
        note: "Instagram handle saved. Complete Meta OAuth connection to activate Instagram Direct.",
      });
    }

    return NextResponse.json({
      ok: true,
      channels: {
        whatsapp: normalizedWhatsApp || null,
        instagram: rawInstagram ? `@${rawInstagram}` : null,
      },
      message: "Agency client channels configured successfully.",
    });
  } catch (error) {
    console.error("[channels/setup] Error setting up channels:", error);
    return NextResponse.json({ ok: false, error: "Failed to configure channels." }, { status: 500 });
  }
}
