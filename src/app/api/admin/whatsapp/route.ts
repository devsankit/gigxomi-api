import { NextResponse } from "next/server";

import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { findWhatsAppLineConflict } from "@/lib/api/whatsapp-line-conflict";
import {
  ensureWhatsAppConnectionDraftFromFile,
  ensureWhatsAppConnectionStateFromFile,
  getWhatsAppConnectionStateFromFile,
  updateWhatsAppConnectionStateFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { DUMMY_WHATSAPP_MANUAL_OVERRIDE_KEYS, type DummyWhatsAppManualOverrides } from "@/lib/gigxomi/dummy-platform-store";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizePhoneNumberId(input: { phoneNumberId?: unknown; wabaId?: unknown; businessId?: unknown; businessPortfolioId?: unknown }) {
  const phoneNumberId = text(input.phoneNumberId);
  if (!phoneNumberId) {
    return "";
  }

  const references = [input.wabaId, input.businessId, input.businessPortfolioId].map(text).filter(Boolean);
  return references.includes(phoneNumberId) ? "" : phoneNumberId;
}

function sanitizeManualOverrides(value: unknown): DummyWhatsAppManualOverrides {
  const overrides = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    DUMMY_WHATSAPP_MANUAL_OVERRIDE_KEYS.map((key) => [key, Boolean(overrides[key])]),
  ) as DummyWhatsAppManualOverrides;
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { searchParams } = new URL(request.url);
  const tenantId = resolveWhatsAppSetupTenantId(authorization.session, searchParams.get("tenantId"));
  const shouldSync = searchParams.get("sync") === "1";
  const shouldEnsureDraft = searchParams.get("ensureDraft") === "1";
  let connection = shouldSync
    ? await ensureWhatsAppConnectionStateFromFile(tenantId).catch(() => null)
    : await getWhatsAppConnectionStateFromFile(tenantId);
  if (!connection && shouldEnsureDraft) {
    connection = await ensureWhatsAppConnectionDraftFromFile({ tenantId });
  }

  return NextResponse.json({
    ok: true,
    tenantId,
    connection,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json();
  const tenantId = resolveWhatsAppSetupTenantId(authorization.session, body?.tenantId);
  const currentConnection = await getWhatsAppConnectionStateFromFile(tenantId);

  const businessId = body?.businessId !== undefined ? text(body.businessId) : (currentConnection?.businessId ?? "");
  const businessPortfolioId =
    body?.businessPortfolioId !== undefined ? text(body.businessPortfolioId) : (currentConnection?.businessPortfolioId ?? "");
  const wabaId = body?.wabaId !== undefined ? text(body.wabaId) : (currentConnection?.wabaId ?? "");
  const manualOverrides = sanitizeManualOverrides(body?.manualOverrides ?? currentConnection?.manualOverrides);
  const phoneNumberId =
    body?.phoneNumberId !== undefined
      ? sanitizePhoneNumberId({
          phoneNumberId: body?.phoneNumberId,
          wabaId: wabaId ?? currentConnection?.wabaId,
          businessId: businessId ?? currentConnection?.businessId,
          businessPortfolioId: businessPortfolioId ?? currentConnection?.businessPortfolioId,
        })
      : (currentConnection?.phoneNumberId ?? "");

  if (body?.phoneNumberId !== undefined && text(body?.phoneNumberId) && !phoneNumberId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Phone number ID cannot match the Meta business, portfolio, or WABA ID. Save the real WhatsApp phone number ID instead.",
        connection: currentConnection,
      },
      { status: 400 },
    );
  }

  if (authorization.session.role === "SALES_AGENT") {
    const conflict = await findWhatsAppLineConflict(tenantId, {
      phoneNumber: body?.phoneNumber !== undefined ? body.phoneNumber : currentConnection?.phoneNumber,
      phoneNumberId,
      wabaId,
    });
    if (conflict) {
      return NextResponse.json(
        {
          ok: false,
          error: "This WhatsApp line is already connected to another Gigxomi account. Use a different number for this sales account.",
          connection: currentConnection,
        },
        { status: 409 },
      );
    }
  }

  const pluginEnabled =
    body?.pluginEnabled !== undefined
      ? Boolean(body.pluginEnabled)
      : (currentConnection?.pluginEnabled ?? true);

  const connection = await updateWhatsAppConnectionStateFromFile(tenantId, {
    pluginEnabled,
    businessName: body?.businessName !== undefined ? body.businessName : currentConnection?.businessName,
    displayName: body?.displayName !== undefined ? body.displayName : currentConnection?.displayName,
    phoneNumber: body?.phoneNumber !== undefined ? body.phoneNumber : currentConnection?.phoneNumber,
    paymentsEnabled: body?.paymentsEnabled !== undefined ? body.paymentsEnabled : currentConnection?.paymentsEnabled,
    paymentsGateway: body?.paymentsGateway !== undefined ? body.paymentsGateway : currentConnection?.paymentsGateway,
    paymentsConfigurationName:
      body?.paymentsConfigurationName !== undefined
        ? body.paymentsConfigurationName
        : currentConnection?.paymentsConfigurationName,
    paymentsTemplateName:
      body?.paymentsTemplateName !== undefined
        ? body.paymentsTemplateName
        : currentConnection?.paymentsTemplateName,
    subscriptionPaymentTemplateName:
      body?.subscriptionPaymentTemplateName !== undefined
        ? body.subscriptionPaymentTemplateName
        : currentConnection?.subscriptionPaymentTemplateName,
    subscriptionPaymentTemplateLanguage:
      body?.subscriptionPaymentTemplateLanguage !== undefined
        ? body.subscriptionPaymentTemplateLanguage
        : currentConnection?.subscriptionPaymentTemplateLanguage,
    renewalReminderTemplateName:
      body?.renewalReminderTemplateName !== undefined
        ? body.renewalReminderTemplateName
        : currentConnection?.renewalReminderTemplateName,
    renewalReminderTemplateLanguage:
      body?.renewalReminderTemplateLanguage !== undefined
        ? body.renewalReminderTemplateLanguage
        : currentConnection?.renewalReminderTemplateLanguage,
    otpTemplateName:
      body?.otpTemplateName !== undefined ? body.otpTemplateName : currentConnection?.otpTemplateName,
    otpTemplateLanguage:
      body?.otpTemplateLanguage !== undefined
        ? body.otpTemplateLanguage
        : currentConnection?.otpTemplateLanguage,
    status: body?.status !== undefined ? body.status : currentConnection?.status,
    note: body?.note !== undefined ? body.note : currentConnection?.note,
    metaAppId: body?.metaAppId !== undefined ? body.metaAppId : currentConnection?.metaAppId,
    metaConfigId: body?.metaConfigId !== undefined ? body.metaConfigId : currentConnection?.metaConfigId,
    sessionInfoVersion:
      body?.sessionInfoVersion !== undefined ? body.sessionInfoVersion : currentConnection?.sessionInfoVersion,
    embeddedSignupVersion:
      body?.embeddedSignupVersion !== undefined
        ? body.embeddedSignupVersion
        : currentConnection?.embeddedSignupVersion,
    verifyToken: body?.verifyToken !== undefined ? body.verifyToken : currentConnection?.verifyToken,
    publicBaseUrl: body?.publicBaseUrl !== undefined ? body.publicBaseUrl : currentConnection?.publicBaseUrl,
    graphApiVersion:
      body?.graphApiVersion !== undefined ? body.graphApiVersion : currentConnection?.graphApiVersion,
    businessId,
    businessPortfolioId,
    wabaId,
    phoneNumberId,
    systemUserId: body?.systemUserId !== undefined ? body.systemUserId : currentConnection?.systemUserId,
    manualOverrides,
    authorizationCode:
      body?.authorizationCode !== undefined ? body.authorizationCode : currentConnection?.authorizationCode,
    accessToken: body?.accessToken !== undefined ? body.accessToken : currentConnection?.accessToken,
    lastLaunchAt: body?.lastLaunchAt !== undefined ? body.lastLaunchAt : currentConnection?.lastLaunchAt,
    lastInboundAt: body?.lastInboundAt !== undefined ? body.lastInboundAt : currentConnection?.lastInboundAt,
    lastOutboundAt: body?.lastOutboundAt !== undefined ? body.lastOutboundAt : currentConnection?.lastOutboundAt,
    lastError: body?.lastError !== undefined ? body.lastError : currentConnection?.lastError,
    lastSignupEvent:
      body?.lastSignupEvent !== undefined ? body.lastSignupEvent : currentConnection?.lastSignupEvent,
    lastSignupEventAt:
      body?.lastSignupEventAt !== undefined ? body.lastSignupEventAt : currentConnection?.lastSignupEventAt,
  });

  return NextResponse.json({
    ok: true,
    tenantId,
    connection,
  });
}
