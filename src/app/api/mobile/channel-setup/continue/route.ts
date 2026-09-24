import { NextResponse } from "next/server";

import { applySessionCookie, getSessionContext } from "@/lib/auth/session";
import { getManagedUserForSession } from "@/lib/billing/subscription-service";
import { consumeChannelSetupIntent, getRequestFingerprint, verifyChannelSetupIntent } from "@/lib/connected-platform/channel-setup-intent";
import { ensureWhatsAppConnectionDraftFromFile, updateInstagramConnectionStateFromFile, updateWhatsAppConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

function secure(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawIntent = url.searchParams.get("intent") ?? "";
  const intent = await verifyChannelSetupIntent(rawIntent);
  if (!intent) return secure(NextResponse.json({ ok: false, error: "This secure setup link is invalid or expired. Return to the app and create a new link." }, { status: 401 }));

  const session = await getSessionContext();
  if (session.userId && session.role !== "GUEST") {
    if (session.userId !== intent.userId || session.tenantId !== intent.tenantId || session.role !== "ADMIN" || session.packageAudience !== "AGENCY") {
      return secure(NextResponse.json({ ok: false, error: "This link belongs to a different Agency owner or workspace. Sign out and use the account that created it." }, { status: 403 }));
    }
  }

  const user = await getManagedUserForSession(intent.userId);
  if (user.packageAudience !== "AGENCY" || user.role !== "ADMIN" || !user.tenantId || user.tenantId !== intent.tenantId) {
    return secure(NextResponse.json({ ok: false, error: "Agency owner access is required." }, { status: 403 }));
  }
  const consumed = await consumeChannelSetupIntent(rawIntent, intent, getRequestFingerprint(request));
  if (!consumed) {
    return secure(NextResponse.json({ ok: false, error: "This setup link was already used or replaced. Return to the app and create a new link." }, { status: 409 }));
  }

  const tenantId = user.tenantId;
  if (intent.channel === "INSTAGRAM") {
    await updateInstagramConnectionStateFromFile(tenantId, {
      pluginEnabled: true,
      status: "Plugin enabled",
      note: "Instagram Inbox enabled during required Agency onboarding.",
    });
  } else {
    await ensureWhatsAppConnectionDraftFromFile({
      tenantId,
      businessName: user.displayName,
      displayName: user.displayName,
      phoneNumber: user.phone,
    });
    await updateWhatsAppConnectionStateFromFile(tenantId, {
      pluginEnabled: true,
      note: "WhatsApp API enabled during required Agency onboarding.",
    });
  }
  const setupPath = intent.channel === "INSTAGRAM" ? "/admin/integrations/instagram" : "/admin/integrations/whatsapp";
  const redirectResponse = secure(NextResponse.redirect(new URL(`${setupPath}?onboarding=1&returnTo=gigxomi%3A%2F%2Fintegrations`, request.url)));
  if (!session.userId || session.role === "GUEST") {
    await applySessionCookie(redirectResponse, {
      ...user,
      userId: user.id,
      packageExpiresAt: user.packageExpiresAt ?? null,
    });
  }
  return redirectResponse;
}
