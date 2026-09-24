import "server-only";

import { updateWhatsAppConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import type { DummyWhatsAppConnectionState } from "@/lib/gigxomi/dummy-platform-store";
import { fetchMetaWhatsAppSetupSummary, subscribeAppToWhatsAppBusinessAccount } from "@/lib/gigxomi/meta-whatsapp-auth";

function logWhatsAppOnboardingStep(step: string, payload?: unknown) {
  console.info(`[WHATSAPP_ONBOARDING] ${step}`, payload ?? {});
}

function keepSavedIdentity(connection: DummyWhatsAppConnectionState) {
  return {
    businessId: connection.businessId,
    businessPortfolioId: connection.businessPortfolioId,
    wabaId: connection.wabaId,
    phoneNumberId: connection.phoneNumberId,
    accessToken: connection.accessToken,
    authorizationCode: connection.authorizationCode,
    systemUserId: connection.systemUserId,
  };
}

export async function subscribeWhatsAppWebhookWithRediscovery(input: {
  tenantId: string;
  connection: DummyWhatsAppConnectionState;
  successNote: string;
  failureNote?: string;
}) {
  const tenantId = input.tenantId;
  let connection = input.connection;
  let retriedWithDiscoveredWaba = false;

  const attemptSubscription = async (attemptConnection: DummyWhatsAppConnectionState) => {
    if (!attemptConnection.accessToken.trim() || !attemptConnection.wabaId.trim()) {
      return {
        ok: false as const,
        error: "Access token or WABA ID is missing. Complete Meta signup before subscribing the webhook app.",
      };
    }

    return subscribeAppToWhatsAppBusinessAccount({
      accessToken: attemptConnection.accessToken,
      wabaId: attemptConnection.wabaId,
      graphApiVersion: attemptConnection.graphApiVersion,
    });
  };

  let subscription = await attemptSubscription(connection);

  if (!subscription.ok && connection.accessToken.trim() && connection.phoneNumberId.trim()) {
    logWhatsAppOnboardingStep("META_WEBHOOK_SUBSCRIBE_REDISCOVERY_START", {
      tenantId,
      failed_waba_id: connection.wabaId,
      phone_number_id: connection.phoneNumberId,
      error: subscription.error,
    });

    const summary = await fetchMetaWhatsAppSetupSummary({
      accessToken: connection.accessToken,
      graphApiVersion: connection.graphApiVersion,
      knownBusinessId: connection.businessId,
      knownBusinessPortfolioId: connection.businessPortfolioId,
      knownWabaId: connection.wabaId,
      knownPhoneNumberId: connection.phoneNumberId,
      knownPhoneNumber: connection.phoneNumber,
      knownDisplayName: connection.displayName,
      knownBusinessName: connection.businessName,
      manualOverrides: connection.manualOverrides,
    });

    if (summary.ok && summary.wabaId && summary.wabaId !== connection.wabaId) {
      retriedWithDiscoveredWaba = true;
      connection =
        (await updateWhatsAppConnectionStateFromFile(tenantId, {
          ...keepSavedIdentity(connection),
          businessId: summary.businessId || connection.businessId,
          businessPortfolioId: summary.businessPortfolioId || connection.businessPortfolioId,
          wabaId: summary.wabaId,
          phoneNumberId: summary.phoneNumberId || connection.phoneNumberId,
          phoneNumber: summary.phoneNumber || connection.phoneNumber,
          displayName: summary.displayName || connection.displayName,
          businessName: summary.businessName || connection.businessName,
          status: summary.phoneNumberId || connection.phoneNumberId ? "Ready for webhook" : "Number connected",
          lastError: "",
          note: "Gigxomi rediscovered the WABA that owns this Cloud API phone number and is retrying webhook subscription.",
        })) ?? connection;

      logWhatsAppOnboardingStep("META_WEBHOOK_SUBSCRIBE_REDISCOVERED_WABA", {
        tenantId,
        previous_waba_id: input.connection.wabaId,
        discovered_waba_id: connection.wabaId,
        phone_number_id: connection.phoneNumberId,
      });

      subscription = await attemptSubscription(connection);
    } else {
      logWhatsAppOnboardingStep("META_WEBHOOK_SUBSCRIBE_REDISCOVERY_NO_MATCH", {
        tenantId,
        failed_waba_id: connection.wabaId,
        phone_number_id: connection.phoneNumberId,
        summary,
      });
    }
  }

  if (subscription.ok) {
    const nextConnection =
      (await updateWhatsAppConnectionStateFromFile(tenantId, {
        ...keepSavedIdentity(connection),
        status: connection.phoneNumberId.trim() ? "Ready for webhook" : connection.wabaId.trim() ? "Number connected" : "Business submitted",
        lastError: "",
        note: input.successNote,
      })) ?? connection;

    return {
      ok: true as const,
      connection: nextConnection,
      retriedWithDiscoveredWaba,
    };
  }

  const nextConnection =
    (await updateWhatsAppConnectionStateFromFile(tenantId, {
      ...keepSavedIdentity(connection),
      status: connection.phoneNumberId.trim() && connection.accessToken.trim() ? "Ready for webhook" : "Number connected",
      lastError: subscription.error,
      note: input.failureNote ?? "WhatsApp line is saved, but webhook app subscription still needs attention.",
    })) ?? connection;

  return {
    ok: false as const,
    error: subscription.error,
    connection: nextConnection,
    retriedWithDiscoveredWaba,
  };
}
