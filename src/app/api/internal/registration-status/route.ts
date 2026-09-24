import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/auth/normalize";
import {
  getInstagramConnectionStateFromFile,
  getWhatsAppConnectionStateFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { getAgencyListingByTenantIdFromFile } from "@/lib/gigxomi/agency-listing-store";

function authorized(request: Request) {
  const key = process.env.REGISTRATION_STATUS_API_KEY?.trim();
  return Boolean(key && request.headers.get("authorization") === `Bearer ${key}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const phone = normalizePhone(new URL(request.url).searchParams.get("phone") ?? "");
  if (!phone) return NextResponse.json({ ok: false, error: "phone is required" }, { status: 400 });

  const user = await prisma.appAuthUser.findFirst({
    where: { OR: [{ phone }, { loginPhoneAliases: { has: phone } }] },
    select: {
      id: true, displayName: true, phone: true, email: true, role: true,
      packageAudience: true, packageStatus: true, packageExpiresAt: true,
      workspaceMode: true, tenantId: true, createdAt: true,
      devicePushTokens: { select: { token: true, platform: true } },
      connectedOnboarding: { select: { audience: true, stage: true, completedAt: true, updatedAt: true } },
      socialConnections: { select: { provider: true, status: true, lastError: true, updatedAt: true } },
      subscriptions: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, packageId: true, status: true, paymentStatus: true, startsAt: true, expiresAt: true, createdAt: true } },
      freelancerWorkspace: { select: { updatedAt: true } },
    },
  });

  const tenantId = user?.tenantId ?? "";

  const [waConn, igConn, agencyProfile] = await Promise.all([
    tenantId ? getWhatsAppConnectionStateFromFile(tenantId).catch(() => null) : Promise.resolve(null),
    tenantId ? getInstagramConnectionStateFromFile(tenantId).catch(() => null) : Promise.resolve(null),
    tenantId ? getAgencyListingByTenantIdFromFile(tenantId).catch(() => null) : Promise.resolve(null),
  ]);

  const isWhatsAppConnected = Boolean(
    waConn &&
    waConn.pluginEnabled &&
    waConn.phoneNumberId?.trim() &&
    (waConn.accessToken?.trim() || waConn.status === "Ready for webhook" || waConn.status === "Number connected")
  );

  const isInstagramConnected = Boolean(
    igConn &&
    igConn.pluginEnabled &&
    igConn.accountId?.trim() &&
    igConn.accessToken?.trim() &&
    igConn.status === "Connected"
  );

  const channels: Array<{
    provider: string;
    status: string;
    connected: boolean;
    hasIssue: boolean;
    issue: string | null;
    phoneNumber?: string | null;
    username?: string | null;
    updatedAt?: string | Date | null;
  }> = [];

  channels.push({
    provider: "WhatsApp",
    status: isWhatsAppConnected ? "Connected" : (waConn?.phoneNumber || user?.phone) ? "Meta Setup Pending" : "Not connected",
    connected: isWhatsAppConnected,
    hasIssue: Boolean(waConn?.lastError),
    issue: waConn?.lastError || null,
    phoneNumber: waConn?.phoneNumber || user?.phone || null,
    updatedAt: waConn?.lastLaunchAt || null,
  });

  channels.push({
    provider: "Instagram",
    status: isInstagramConnected ? "Connected" : igConn?.username ? "OAuth Pending" : "Not connected",
    connected: isInstagramConnected,
    hasIssue: Boolean(igConn?.lastError),
    issue: igConn?.lastError || null,
    username: igConn?.username ? `@${igConn.username.replace(/^@/, "")}` : null,
    updatedAt: igConn?.lastInboundAt || null,
  });

  const hasAppInstalled = Boolean(
    user?.connectedOnboarding?.completedAt ||
    user?.connectedOnboarding?.stage === "COMPLETE" ||
    (user?.devicePushTokens && user.devicePushTokens.length > 0)
  );

  const isPaid = Boolean(
    user?.subscriptions?.some((s) =>
      ["ACTIVE", "TRIALING", "PAID"].includes(String(s.status)) ||
      String(s.paymentStatus) === "PAID"
    )
  );

  return NextResponse.json({
    ok: true,
    registered: Boolean(user),
    appInstalled: hasAppInstalled,
    paid: isPaid,
    channels,
    status: user?.packageStatus || (isWhatsAppConnected ? "Live" : "Setup Pending"),
    registration: user
      ? {
          id: user.id,
          displayName: user.displayName,
          agencyName: agencyProfile?.publicName || user.displayName,
          phone: user.phone,
          email: user.email,
          role: user.role,
          audience: user.packageAudience,
          status: user.packageStatus,
          packageExpiresAt: user.packageExpiresAt,
          workspaceMode: user.workspaceMode,
          tenantId: user.tenantId,
          createdAt: user.createdAt,
          onboarding: user.connectedOnboarding,
          channels,
          appInstalled: hasAppInstalled,
          workspaceCreated: Boolean(user.freelancerWorkspace),
          subscriptions: user.subscriptions,
          paid: isPaid,
        }
      : null,
  });
}
