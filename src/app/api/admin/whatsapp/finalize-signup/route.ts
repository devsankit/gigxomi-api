import { NextResponse } from "next/server";

import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { findWhatsAppLineConflict } from "@/lib/api/whatsapp-line-conflict";
import { getWhatsAppConnectionStateFromFile, updateWhatsAppConnectionStateFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import {
  exchangeMetaAuthorizationCode,
  fetchMetaWhatsAppSetupSummary,
  registerWhatsAppPhoneNumber,
} from "@/lib/gigxomi/meta-whatsapp-auth";
import { extractMetaEmbeddedSignupData, pickMetaText } from "@/lib/gigxomi/meta-whatsapp-signup";
import { subscribeWhatsAppWebhookWithRediscovery } from "@/lib/gigxomi/whatsapp-onboarding-subscribe";
import { encryptConnectedSecret } from "@/lib/connected-platform/secret-box";
import { prisma } from "@/lib/prisma";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizePhoneNumberId(input: {
  phoneNumberId?: unknown;
  wabaId?: unknown;
  businessId?: unknown;
  businessPortfolioId?: unknown;
}) {
  const phoneNumberId = text(input.phoneNumberId);
  if (!phoneNumberId) {
    return "";
  }

  const references = [input.wabaId, input.businessId, input.businessPortfolioId].map(text).filter(Boolean);
  return references.includes(phoneNumberId) ? "" : phoneNumberId;
}

function resolveRedirectUri(publicBaseUrl: string) {
  if (!publicBaseUrl.trim()) {
    return "";
  }

  try {
    return new URL("/meta/whatsapp/callback", publicBaseUrl).toString();
  } catch {
    return "";
  }
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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const signupData = extractMetaEmbeddedSignupData(body);
  const tenantId = resolveWhatsAppSetupTenantId(authorization.session, text(body?.tenantId));
  const connection = await getWhatsAppConnectionStateFromFile(tenantId);

  if (!connection) {
    return NextResponse.json({ ok: false, error: "WhatsApp setup is not available for this tenant yet." }, { status: 404 });
  }

  const lastSignupEvent = text(body?.lastSignupEvent) || "FINISH";
  const lastSignupEventAt = text(body?.lastSignupEventAt) || new Date().toISOString();
  const authorizationCode = pickMetaText(body?.authorizationCode, body?.authorization_code, signupData.code);
  if (authorizationCode) {
    logWhatsAppOnboardingStep("STEP_3_AUTH_CODE_RECEIVED", {
      tenantId,
      hasAuthorizationCode: true,
    });
    logWhatsAppOnboardingStep("META_AUTH_CODE_RECEIVED", {
      tenantId,
      hasAuthorizationCode: true,
    });
  }
  const submittedBusinessId = pickMetaText(body?.businessId, body?.business_id, signupData.business_id);
  const submittedBusinessPortfolioId = pickMetaText(body?.businessPortfolioId, body?.business_portfolio_id, signupData.business_portfolio_id);
  const submittedWabaId = pickMetaText(body?.wabaId, body?.waba_id, signupData.waba_id);
  const bodyBusinessId = submittedBusinessId || connection.businessId;
  const bodyBusinessPortfolioId = submittedBusinessPortfolioId || connection.businessPortfolioId;
  const bodyWabaId = submittedWabaId || connection.wabaId;
  const bodyPhoneNumber = pickMetaText(body?.phoneNumber, body?.display_phone_number, body?.phone_number, signupData.display_phone_number);
  const bodyPhoneNumberId = sanitizePhoneNumberId({
    phoneNumberId: pickMetaText(body?.phoneNumberId, body?.phone_number_id, signupData.phone_number_id),
    wabaId: bodyWabaId,
    businessId: bodyBusinessId,
    businessPortfolioId: bodyBusinessPortfolioId,
  });
  const submittedSystemUserId = pickMetaText(body?.systemUserId, body?.system_user_id, signupData.system_user_id);
  const submittedDisplayName = pickMetaText(body?.displayName, body?.display_name, signupData.display_name);
  const submittedBusinessName = pickMetaText(body?.businessName, body?.business_name, signupData.business_name);
  const hasReturnedMetaSetupData = Boolean(
    authorizationCode ||
      submittedBusinessId ||
      submittedBusinessPortfolioId ||
      submittedWabaId ||
      bodyPhoneNumber ||
      bodyPhoneNumberId ||
      submittedSystemUserId ||
      submittedDisplayName ||
      submittedBusinessName,
  );

  let accessToken = pickMetaText(body?.accessToken, body?.access_token, signupData.access_token) || connection.accessToken;
  let exchangeError: string | null = null;

  if (!accessToken && !hasReturnedMetaSetupData) {
    logWhatsAppOnboardingStep("FAILED_AT_STEP_3_AUTH_CODE_RECEIVED", {
      tenantId,
      body,
      signupData,
      captured: {
        hasAuthorizationCode: false,
        hasAccessToken: false,
        hasBusinessId: false,
        hasWabaId: false,
        hasPhoneNumberId: false,
      },
    });
    const nextConnection = await updateWhatsAppConnectionStateFromFile(tenantId, {
      pluginEnabled: true,
      status: connection.status === "Not started" ? "Onboarding in progress" : connection.status,
      lastError:
        "Meta signup finished, but the browser callback did not include an authorization code, WABA ID, or phone number ID. Check Facebook Login for Business: Client OAuth Login, Web OAuth Login, Login with JavaScript SDK, allowed domain gigxomi.com, and the Valid OAuth Redirect URI https://gigxomi.com/meta/whatsapp/callback.",
      lastSignupEvent,
      lastSignupEventAt,
      note: "Meta signup completed visually, but Gigxomi did not receive the auth code or WhatsApp setup IDs needed to register the Cloud API line.",
    });

    return NextResponse.json(
      {
        ok: false,
        tenantId,
        connection: nextConnection,
        error:
          "Meta did not return an authorization code or WhatsApp setup IDs to Gigxomi. Recheck Facebook Login for Business OAuth/JSSDK settings and the Embedded Signup configuration.",
        captured: {
          event: lastSignupEvent,
          hasAuthorizationCode: false,
          hasAccessToken: false,
          hasBusinessId: false,
          hasWabaId: false,
          hasPhoneNumberId: false,
        },
      },
      { status: 400 },
    );
  }

  if (!accessToken && authorizationCode) {
    logWhatsAppOnboardingStep("META_AUTH_EXCHANGE_START", {
      tenantId,
      appId: connection.metaAppId,
      graphApiVersion: connection.graphApiVersion,
      redirectUri: resolveRedirectUri(connection.publicBaseUrl),
    });
    const exchange = await exchangeMetaAuthorizationCode({
      appId: connection.metaAppId,
      authorizationCode,
      graphApiVersion: connection.graphApiVersion,
      redirectUri: resolveRedirectUri(connection.publicBaseUrl),
    });

    if (exchange.ok) {
      accessToken = exchange.accessToken;
      logWhatsAppOnboardingStep("META_AUTH_EXCHANGE_SUCCESS", {
        tenantId,
        tokenType: exchange.tokenType,
        expiresIn: exchange.expiresIn,
        debugExpiresAt: exchange.debugExpiresAt,
      });
    } else {
      exchangeError = exchange.error;
      logWhatsAppOnboardingStep("META_AUTH_EXCHANGE_FAILED", {
        tenantId,
        error: exchange.error,
      });
    }
  }

  const summary = accessToken
    ? await fetchMetaWhatsAppSetupSummary({
        accessToken,
        graphApiVersion: connection.graphApiVersion,
        knownBusinessId: submittedBusinessId,
        knownBusinessPortfolioId: submittedBusinessPortfolioId,
        knownWabaId: submittedWabaId,
        knownPhoneNumberId: bodyPhoneNumberId,
        knownPhoneNumber: bodyPhoneNumber,
        knownDisplayName: pickMetaText(body?.displayName, body?.display_name, signupData.display_name) || connection.displayName,
        knownBusinessName: pickMetaText(body?.businessName, body?.business_name, signupData.business_name) || connection.businessName,
        manualOverrides: connection.manualOverrides,
      })
    : null;

  const summaryWarning = summary?.ok && summary.warnings.length ? ` ${summary.warnings.join(" ")}` : "";
  const resolvedPhoneNumber = summary?.ok ? summary.phoneNumber : bodyPhoneNumber;
  const resolvedPhoneNumberId = summary?.ok
    ? summary.phoneNumberId || bodyPhoneNumberId || connection.phoneNumberId
    : bodyPhoneNumberId || connection.phoneNumberId;
  if (authorization.session.role === "SALES_AGENT") {
    const conflict = await findWhatsAppLineConflict(tenantId, {
      phoneNumber: resolvedPhoneNumber,
      phoneNumberId: resolvedPhoneNumberId,
      wabaId: summary?.ok ? summary.wabaId || bodyWabaId : bodyWabaId,
    });
    if (conflict) {
      return NextResponse.json(
        {
          ok: false,
          tenantId,
          connection,
          error: "This WhatsApp line is already connected to another Gigxomi account. Use a different number for this sales account.",
          captured: {
            event: lastSignupEvent,
            hasAuthorizationCode: Boolean(authorizationCode),
            hasAccessToken: Boolean(accessToken),
            hasBusinessId: Boolean(summary?.ok ? summary.businessId : bodyBusinessId),
            hasWabaId: Boolean(summary?.ok ? summary.wabaId : bodyWabaId),
            hasPhoneNumberId: Boolean(resolvedPhoneNumberId),
          },
        },
        { status: 409 },
      );
    }
  }

  if (summary?.ok && summary.wabaId) {
    logWhatsAppOnboardingStep("META_WABA_DISCOVERED", {
      tenantId,
      business_id: summary.businessId,
      business_portfolio_id: summary.businessPortfolioId,
      waba_id: summary.wabaId,
      source: "graph_summary",
    });
  } else if (bodyWabaId) {
    logWhatsAppOnboardingStep("META_WABA_DISCOVERED", {
      tenantId,
      business_id: bodyBusinessId,
      business_portfolio_id: bodyBusinessPortfolioId,
      waba_id: bodyWabaId,
      source: "browser_payload",
    });
  }

  if (resolvedPhoneNumberId) {
    logWhatsAppOnboardingStep("META_PHONE_DISCOVERED", {
      tenantId,
      phone_number_id: resolvedPhoneNumberId,
      display_phone_number: resolvedPhoneNumber,
      display_name: summary?.ok ? summary.displayName : submittedDisplayName,
      source: summary?.ok && summary.phoneNumberId ? "graph_summary" : "browser_or_existing_payload",
    });
  }

  let nextConnection = await updateWhatsAppConnectionStateFromFile(tenantId, {
    pluginEnabled: true,
    businessId: summary?.ok ? summary.businessId || connection.businessId : bodyBusinessId,
    businessPortfolioId: summary?.ok ? summary.businessPortfolioId || connection.businessPortfolioId : bodyBusinessPortfolioId,
    wabaId: summary?.ok ? summary.wabaId || connection.wabaId : bodyWabaId,
    phoneNumberId: resolvedPhoneNumberId,
    systemUserId: submittedSystemUserId || connection.systemUserId,
    authorizationCode: accessToken ? "" : authorizationCode || connection.authorizationCode,
    accessToken: accessToken || connection.accessToken,
    displayName: summary?.ok ? summary.displayName || connection.displayName : submittedDisplayName || connection.displayName,
    businessName: summary?.ok
      ? summary.businessName || connection.businessName
      : submittedBusinessName || connection.businessName,
    phoneNumber: resolvedPhoneNumber || bodyPhoneNumber || connection.phoneNumber,
    status:
      resolvedPhoneNumberId
        ? "Ready for webhook"
        : bodyWabaId
          ? "Number connected"
          : "Business submitted",
    lastError: exchangeError || (!resolvedPhoneNumberId && !summary?.ok && summary ? summary.error : ""),
    lastSignupEvent,
    lastSignupEventAt,
    note:
      exchangeError || (!resolvedPhoneNumberId && !summary?.ok && summary ? summary.error : "")
        ? "Meta signup returned credentials, but Gigxomi still needs attention before the official line can go live."
        : `Meta signup finished and Gigxomi captured the current Cloud API phone details.${summaryWarning || (!summary?.ok && summary ? ` ${summary.error}` : "")}`.trim(),
  });
  logWhatsAppOnboardingStep("STEP_8_DB_SAVE_SUCCESS", {
    tenantId,
    has_authorization_code: Boolean(authorizationCode),
    has_access_token: Boolean(accessToken || connection.accessToken),
    business_id: nextConnection?.businessId,
    business_portfolio_id: nextConnection?.businessPortfolioId,
    waba_id: nextConnection?.wabaId,
    phone_number_id: nextConnection?.phoneNumberId,
    connection: nextConnection,
  });
  logWhatsAppOnboardingStep("META_CONNECTION_SAVED", {
    tenantId,
    has_access_token: Boolean(nextConnection?.accessToken?.trim()),
    business_id: nextConnection?.businessId,
    business_portfolio_id: nextConnection?.businessPortfolioId,
    waba_id: nextConnection?.wabaId,
    phone_number_id: nextConnection?.phoneNumberId,
    status: nextConnection?.status,
    lastError: nextConnection?.lastError,
  });

  const keepSavedIdentity = () =>
    nextConnection
      ? {
          businessId: nextConnection.businessId,
          businessPortfolioId: nextConnection.businessPortfolioId,
          wabaId: nextConnection.wabaId,
          phoneNumberId: nextConnection.phoneNumberId,
          accessToken: nextConnection.accessToken,
          authorizationCode: nextConnection.authorizationCode,
          systemUserId: nextConnection.systemUserId,
        }
      : {};

  let registrationError: string | null = null;
  let metaRegistrationResponse: unknown = null;
  const submittedRegistrationPin = text(body?.registrationPin ?? body?.pin ?? body?.twoFactorPin);
  const registrationPin = submittedRegistrationPin || DEFAULT_WHATSAPP_REGISTRATION_PIN;
  const shouldAttemptPhoneRegistration = Boolean(nextConnection?.accessToken.trim() && nextConnection.phoneNumberId.trim());
  if (shouldAttemptPhoneRegistration && nextConnection) {
    logWhatsAppOnboardingStep("META_PHONE_REGISTER_START", {
      tenantId,
      phone_number_id: nextConnection.phoneNumberId,
      graphApiVersion: nextConnection.graphApiVersion,
      source: "finalize_signup",
      has_pin: Boolean(registrationPin),
      used_default_pin: !submittedRegistrationPin,
    });
    const registration = await registerWhatsAppPhoneNumber({
      accessToken: nextConnection.accessToken,
      phoneNumberId: nextConnection.phoneNumberId,
      pin: registrationPin || undefined,
      graphApiVersion: nextConnection.graphApiVersion,
    });
    metaRegistrationResponse = registration.metaResponse ?? null;

    if (registration.ok) {
      logWhatsAppOnboardingStep("META_PHONE_REGISTER_SUCCESS", {
        tenantId,
        phone_number_id: nextConnection.phoneNumberId,
        alreadyRegistered: registration.alreadyRegistered,
        metaResponse: metaRegistrationResponse,
      });
      nextConnection = await updateWhatsAppConnectionStateFromFile(tenantId, {
        ...keepSavedIdentity(),
        status: "Ready for webhook",
        lastError: "",
        note: registration.alreadyRegistered
          ? "Meta signup finished, Gigxomi confirmed this phone number is already registered for Cloud API sending, and the official line is ready for webhook setup."
          : "Meta signup finished, Gigxomi registered the phone number for Cloud API sending, and the official line is ready for webhook setup.",
      });
    } else {
      registrationError = registration.error;
      logWhatsAppOnboardingStep("META_PHONE_REGISTER_FAILED", {
        tenantId,
        phone_number_id: nextConnection.phoneNumberId,
        error: registration.error,
        metaResponse: metaRegistrationResponse,
      });
      nextConnection = await updateWhatsAppConnectionStateFromFile(tenantId, {
        ...keepSavedIdentity(),
        status: "Number connected",
        lastError: registration.error,
        note: "Meta signup captured the phone number ID, but the optional manual Cloud API registration retry failed. If this line was provisioned by Embedded Signup, try a test send or confirm webhook delivery before rerunning manual registration.",
      });
    }
  }

  let subscriptionError: string | null = null;

  if (nextConnection?.accessToken.trim() && nextConnection.wabaId.trim()) {
    const subscription = await subscribeWhatsAppWebhookWithRediscovery({
      tenantId,
      connection: nextConnection,
      successNote: registrationError
        ? `Meta signup captured the phone number and subscribed the webhook app, but Cloud API sending still needs phone registration attention: ${registrationError}`.trim()
        : nextConnection.phoneNumberId.trim()
          ? `Meta signup finished, Gigxomi captured the official line details, and the webhook app is subscribed.${summaryWarning}`.trim()
          : `Meta signup finished and the webhook app is subscribed. Complete the Meta phone registration step if the number still shows as pending.${summaryWarning}`.trim(),
      failureNote: "Meta signup data was captured, but webhook app subscription still needs attention.",
    });

    if (subscription.ok) {
      logWhatsAppOnboardingStep("META_WEBHOOK_SUBSCRIBE_SUCCESS", {
        tenantId,
        waba_id: subscription.connection.wabaId,
        retriedWithDiscoveredWaba: subscription.retriedWithDiscoveredWaba,
      });
      nextConnection = subscription.connection;
      if (registrationError) {
        nextConnection =
          (await updateWhatsAppConnectionStateFromFile(tenantId, {
            ...keepSavedIdentity(),
            status: "Ready for webhook",
            lastError: registrationError,
            note: `Meta signup captured the phone number and subscribed the webhook app, but Cloud API phone registration requires the 6-digit PIN: ${registrationError}`,
          })) ?? nextConnection;
      }
    } else {
      subscriptionError = subscription.error;
      nextConnection = subscription.connection;
    }
  }

  const hasConnectedPhoneNumberId = Boolean(nextConnection?.phoneNumberId?.trim());
  const ok = !exchangeError && (!summary || summary.ok || hasConnectedPhoneNumberId);
  if (nextConnection && authorization.session.userId) {
    const connected = ok && hasConnectedPhoneNumberId;
    await prisma.appSocialConnection.upsert({
      where: { userId_provider: { userId: authorization.session.userId, provider: "WHATSAPP" } },
      create: {
        userId: authorization.session.userId,
        provider: "WHATSAPP",
        status: connected ? "CONNECTED" : "ERROR",
        externalAccountId: nextConnection.phoneNumberId || nextConnection.wabaId || null,
        displayName: nextConnection.displayName || nextConnection.businessName || null,
        accessTokenCiphertext: nextConnection.accessToken?.trim() ? encryptConnectedSecret(nextConnection.accessToken) : null,
        webhookSubscribedAt: connected ? new Date() : null,
        lastError: connected ? null : exchangeError || registrationError || subscriptionError || nextConnection.lastError || "WhatsApp setup is incomplete.",
        metadata: { wabaId: nextConnection.wabaId, phoneNumberId: nextConnection.phoneNumberId, businessId: nextConnection.businessId },
      },
      update: {
        status: connected ? "CONNECTED" : "ERROR",
        externalAccountId: nextConnection.phoneNumberId || nextConnection.wabaId || null,
        displayName: nextConnection.displayName || nextConnection.businessName || null,
        accessTokenCiphertext: nextConnection.accessToken?.trim() ? encryptConnectedSecret(nextConnection.accessToken) : undefined,
        webhookSubscribedAt: connected ? new Date() : null,
        lastError: connected ? null : exchangeError || registrationError || subscriptionError || nextConnection.lastError || "WhatsApp setup is incomplete.",
        metadata: { wabaId: nextConnection.wabaId, phoneNumberId: nextConnection.phoneNumberId, businessId: nextConnection.businessId },
      },
    });
    if (connected) {
      await prisma.connectedOnboardingState.updateMany({
        where: { userId: authorization.session.userId, audience: "AGENCY" },
        data: { stage: "COMPLETE", completedAt: new Date(), activatedAt: new Date() },
      });
      try {
        const { autoQualifyLeadByCustomerPhone } = await import("@/lib/gigxomi/auto-lead-qualifier");
        const phoneToQualify = authorization.session.phone || nextConnection.phoneNumber || "";
        if (phoneToQualify) {
          await autoQualifyLeadByCustomerPhone({
            phone: phoneToQualify,
            targetStatus: "agency-connected",
            reason: "Agency connected WhatsApp line via Meta Embedded Signup",
            userId: authorization.session.userId,
            email: authorization.session.email ?? undefined,
          });
        }
        if (nextConnection.phoneNumber && nextConnection.phoneNumber !== authorization.session.phone) {
          await autoQualifyLeadByCustomerPhone({
            phone: nextConnection.phoneNumber,
            targetStatus: "agency-connected",
            reason: "Agency connected WhatsApp line via Meta Embedded Signup",
            userId: authorization.session.userId,
            email: authorization.session.email ?? undefined,
          });
        }
      } catch (err) {
        console.error("[finalize-signup] Auto qualify lead error:", err);
      }
    }
  }
  if (ok && hasConnectedPhoneNumberId && nextConnection) {
    logWhatsAppOnboardingStep("META_ONBOARDING_COMPLETE", {
      tenantId,
      status: nextConnection.status,
      waba_id: nextConnection.wabaId,
      phone_number_id: nextConnection.phoneNumberId,
      registrationAttempted: shouldAttemptPhoneRegistration,
      registrationHadPin: Boolean(registrationPin),
      registrationError,
      metaRegistrationResponse,
      subscriptionError,
      phonePendingLikelyReason: registrationError
        ? "phone registration failed"
        : "Meta display name review or WhatsApp Manager status may still be pending even after Cloud API registration succeeds",
    });
  }
  return NextResponse.json(
    {
      ok: ok && Boolean(hasConnectedPhoneNumberId || !registrationError),
      tenantId,
      connection: nextConnection,
      captured: {
        event: lastSignupEvent,
        hasAuthorizationCode: Boolean(authorizationCode),
        hasAccessToken: Boolean(accessToken),
        hasBusinessId: Boolean(summary?.ok ? summary.businessId : bodyBusinessId),
        hasWabaId: Boolean(summary?.ok ? summary.wabaId : bodyWabaId),
        hasPhoneNumberId: hasConnectedPhoneNumberId,
      },
      exchangeError,
      summaryError: !summary || summary.ok ? null : summary.error,
      registrationAttempted: shouldAttemptPhoneRegistration,
      registrationError,
      metaRegistrationResponse,
      subscriptionError,
    },
    { status: ok && (hasConnectedPhoneNumberId || !registrationError) ? 200 : 400 },
  );
}
