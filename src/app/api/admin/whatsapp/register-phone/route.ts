import { NextResponse } from "next/server";

import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { getWhatsAppConnectionStateFromFile, updateWhatsAppConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { registerWhatsAppPhoneNumber } from "@/lib/gigxomi/meta-whatsapp-auth";
import { subscribeWhatsAppWebhookWithRediscovery } from "@/lib/gigxomi/whatsapp-onboarding-subscribe";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function logWhatsAppOnboardingStep(step: string, payload?: unknown) {
  console.info(`[WHATSAPP_ONBOARDING] ${step}`, payload ?? {});
}

const DEFAULT_WHATSAPP_REGISTRATION_PIN = "889900";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json().catch(() => null);
  const tenantId = resolveWhatsAppSetupTenantId(authorization.session, body?.tenantId);
  const connection = await getWhatsAppConnectionStateFromFile(tenantId);
  if (!connection) {
    return NextResponse.json({ ok: false, error: "WhatsApp setup is not available for this tenant yet." }, { status: 404 });
  }

  const keepSavedIdentity = {
    businessId: connection.businessId,
    businessPortfolioId: connection.businessPortfolioId,
    wabaId: connection.wabaId,
    phoneNumberId: connection.phoneNumberId,
    accessToken: connection.accessToken,
    authorizationCode: connection.authorizationCode,
    systemUserId: connection.systemUserId,
  };

  const submittedRegistrationPin = text(body?.registrationPin ?? body?.pin ?? body?.twoFactorPin);
  const registrationPin = submittedRegistrationPin || DEFAULT_WHATSAPP_REGISTRATION_PIN;
  let registration: Awaited<ReturnType<typeof registerWhatsAppPhoneNumber>> = { ok: true };
  logWhatsAppOnboardingStep("REGISTER_PHONE_REQUEST", {
    tenantId,
    source: "api_admin_whatsapp_register_phone",
    hasAccessToken: Boolean(connection.accessToken.trim()),
    hasPhoneNumberId: Boolean(connection.phoneNumberId.trim()),
    phone_number_id: connection.phoneNumberId,
    has_pin: Boolean(registrationPin),
    used_default_pin: !submittedRegistrationPin,
  });

  if (connection.accessToken.trim() && connection.phoneNumberId.trim()) {
    registration = await registerWhatsAppPhoneNumber({
      accessToken: connection.accessToken,
      phoneNumberId: connection.phoneNumberId,
      pin: registrationPin || undefined,
      graphApiVersion: connection.graphApiVersion,
    });

    if (!registration.ok) {
      const nextConnection = await updateWhatsAppConnectionStateFromFile(tenantId, {
        ...keepSavedIdentity,
        status: connection.phoneNumberId.trim() ? "Number connected" : connection.status,
        lastError: registration.error,
        note: "Cloud API phone registration failed. The PIN retry is optional; the saved line can still use webhook validation after Embedded Signup provisioning completes.",
      });
      logWhatsAppOnboardingStep("REGISTER_PHONE_FAILED", {
        tenantId,
        phone_number_id: connection.phoneNumberId,
        error: registration.error,
        metaResponse: registration.metaResponse ?? null,
        persisted: {
          status: nextConnection?.status,
          hasAccessToken: Boolean(nextConnection?.accessToken?.trim()),
          hasPhoneNumberId: Boolean(nextConnection?.phoneNumberId?.trim()),
          hasWabaId: Boolean(nextConnection?.wabaId?.trim()),
          lastError: nextConnection?.lastError,
        },
      });

      return NextResponse.json(
        {
          ok: false,
          error: registration.error,
          metaRegistrationResponse: registration.metaResponse ?? null,
          connection: nextConnection,
        },
        { status: 400 },
      );
    }
  } else {
    logWhatsAppOnboardingStep("REGISTER_PHONE_FAILED", {
      tenantId,
      phone_number_id: connection.phoneNumberId,
      error: "Missing access token or phone number ID before Meta registration.",
      metaResponse: null,
    });
  }

  let nextConnection = await updateWhatsAppConnectionStateFromFile(tenantId, {
    ...keepSavedIdentity,
    status: connection.phoneNumberId.trim() ? "Ready for webhook" : "Number connected",
    lastError: "",
    note: registration.alreadyRegistered
        ? "Phone number was already registered for WhatsApp Cloud API sending. Gigxomi is confirming webhook subscription next."
        : registrationPin
          ? "Phone number registered for WhatsApp Cloud API sending. Gigxomi is confirming webhook subscription next."
          : "Phone number registration was attempted without a PIN. Gigxomi is confirming webhook subscription next.",
  });
  logWhatsAppOnboardingStep("REGISTER_PHONE_SUCCESS", {
    tenantId,
    phone_number_id: nextConnection?.phoneNumberId,
    alreadyRegistered: registration.ok ? registration.alreadyRegistered : undefined,
    metaResponse: registration.ok ? registration.metaResponse ?? null : null,
    persisted: {
      status: nextConnection?.status,
      hasAccessToken: Boolean(nextConnection?.accessToken?.trim()),
      hasPhoneNumberId: Boolean(nextConnection?.phoneNumberId?.trim()),
      hasWabaId: Boolean(nextConnection?.wabaId?.trim()),
      lastError: nextConnection?.lastError,
    },
  });
  let subscriptionError: string | null = null;

  if (nextConnection?.accessToken.trim() && nextConnection.wabaId.trim()) {
    const subscription = await subscribeWhatsAppWebhookWithRediscovery({
      tenantId,
      connection: nextConnection,
      successNote: "Phone number registration path completed and webhook app subscription confirmed.",
      failureNote: "Phone number is saved, but webhook app subscription still needs attention.",
    });

    if (subscription.ok) {
      nextConnection = subscription.connection;
    } else {
      subscriptionError = subscription.error;
      nextConnection = subscription.connection;
    }
  }

  return NextResponse.json({
    ok: true,
    tenantId,
    connection: nextConnection,
    metaRegistrationResponse: registration.ok ? registration.metaResponse ?? null : null,
    subscriptionError,
  });
}
