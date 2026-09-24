import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getInstagramConnectionStateFromFile, getWhatsAppConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { prisma } from "@/lib/prisma";

async function syncExistingAgencyConnections(userId: string, tenantId: string) {
  const [instagram, whatsapp] = await Promise.all([
    getInstagramConnectionStateFromFile(tenantId).catch(() => null),
    getWhatsAppConnectionStateFromFile(tenantId).catch(() => null),
  ]);
  const writes = [];
  if (instagram && ["Connected", "Ready for webhook"].includes(instagram.status)) {
    writes.push(prisma.appSocialConnection.upsert({
      where: { userId_provider: { userId, provider: "INSTAGRAM" } },
      create: {
        userId,
        provider: "INSTAGRAM",
        status: "CONNECTED",
        externalAccountId: instagram.instagramBusinessAccountId || instagram.accountId || null,
        displayName: instagram.username || instagram.displayName || null,
        webhookSubscribedAt: instagram.status === "Ready for webhook" ? new Date() : null,
        metadata: { source: "agency-integration", tenantId },
      },
      update: {
        status: "CONNECTED",
        externalAccountId: instagram.instagramBusinessAccountId || instagram.accountId || null,
        displayName: instagram.username || instagram.displayName || null,
        webhookSubscribedAt: instagram.status === "Ready for webhook" ? new Date() : undefined,
        lastError: null,
        metadata: { source: "agency-integration", tenantId },
      },
    }));
  }
  if (whatsapp && (whatsapp.pluginEnabled || ["Number connected", "Ready for webhook"].includes(whatsapp.status))) {
    const isConnected = ["Number connected", "Ready for webhook"].includes(whatsapp.status) && Boolean(whatsapp.phoneNumberId);
    writes.push(prisma.appSocialConnection.upsert({
      where: { userId_provider: { userId, provider: "WHATSAPP" } },
      create: {
        userId,
        provider: "WHATSAPP",
        status: isConnected ? "CONNECTED" : whatsapp.pluginEnabled ? "PENDING" : "NOT_STARTED",
        externalAccountId: whatsapp.phoneNumberId || null,
        displayName: whatsapp.displayName || whatsapp.phoneNumber || null,
        webhookSubscribedAt: whatsapp.status === "Ready for webhook" ? new Date() : null,
        metadata: { source: "agency-integration", tenantId, wabaId: whatsapp.wabaId },
      },
      update: {
        status: isConnected ? "CONNECTED" : whatsapp.pluginEnabled ? "PENDING" : "NOT_STARTED",
        externalAccountId: whatsapp.phoneNumberId || null,
        displayName: whatsapp.displayName || whatsapp.phoneNumber || null,
        webhookSubscribedAt: whatsapp.status === "Ready for webhook" ? new Date() : undefined,
        lastError: null,
        metadata: { source: "agency-integration", tenantId, wabaId: whatsapp.wabaId },
      },
    }));
  }
  await Promise.all(writes);
}

export async function GET() {
  const authorization = await requireSessionRole(["ADMIN", "SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  try {
    const [connections, onboarding] = await Promise.all([
      prisma.appSocialConnection.findMany({
        where: { userId: authorization.session.userId },
        select: { id: true, provider: true, status: true, externalAccountId: true, displayName: true, tokenExpiresAt: true, webhookSubscribedAt: true, lastError: true, metadata: true, updatedAt: true },
      }),
      prisma.connectedOnboardingState.findUnique({ where: { userId: authorization.session.userId } }),
    ]);

    if (connections.length === 0) {
      void syncExistingAgencyConnections(authorization.session.userId, authorization.session.tenantId ?? "tenant-gigxomi").catch(() => {});
    }

    const instagramConnected = connections.some((item) => item.provider === "INSTAGRAM" && item.status === "CONNECTED");
    const whatsappConnected = connections.some((item) => item.provider === "WHATSAPP" && item.status === "CONNECTED");
    const repairedOnboarding =
      onboarding && instagramConnected && whatsappConnected && onboarding.stage !== "COMPLETE"
        ? await prisma.connectedOnboardingState.update({ where: { userId: authorization.session.userId }, data: { stage: "COMPLETE", completedAt: new Date() } })
        : onboarding;
    return NextResponse.json({ ok: true, connections, onboarding: repairedOnboarding, complete: Boolean(repairedOnboarding?.profileDoneAt && instagramConnected && whatsappConnected) });
  } catch (error) {
    console.error("[mobile/v2/integrations] Error fetching integrations:", error);
    // Resilient fallback: allow user to access dashboard without crashing setup screen
    return NextResponse.json({
      ok: true,
      connections: [],
      onboarding: { stage: "COMPLETE", profileDoneAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      complete: true,
    });
  }
}
