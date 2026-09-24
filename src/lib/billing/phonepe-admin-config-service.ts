import "server-only";

import type { Prisma } from "@prisma/client";

import { buildPhonePeUrls } from "@/lib/billing/phonepe-config";
import { prisma } from "@/lib/prisma";

export type PhonePeCapability = "one_time" | "autopay" | "webhook";

export type PhonePeAdminSettingsInput = {
  pluginEnabled?: boolean;
  oneTimeEnabled?: boolean;
  autopayEnabled?: boolean;
  webhookEnabled?: boolean;
};

type PhonePeStoredConfig = Required<PhonePeAdminSettingsInput> & {
  updatedByUserId?: string | null;
  lastProviderStatus?: string | null;
  lastRequestId?: string | null;
  lastCheckedAt?: string | null;
};

const PHONEPE_REQUIRED_ENV_KEYS = [
  "PHONEPE_CLIENT_ID",
  "PHONEPE_ENV",
  "APP_BASE_URL",
] as const;

const PHONEPE_WEBHOOK_ENV_KEYS = ["PHONEPE_WEBHOOK_USERNAME", "PHONEPE_WEBHOOK_PASSWORD"] as const;
const PHONEPE_OPTIONAL_ENV_KEYS = ["PHONEPE_CLIENT_VERSION", "PHONEPE_MERCHANT_ID", "PHONEPE_SALT_KEY", "PHONEPE_SALT_INDEX"] as const;

const DEFAULT_CONFIG: PhonePeStoredConfig = {
  pluginEnabled: false,
  oneTimeEnabled: false,
  autopayEnabled: false,
  webhookEnabled: false,
  updatedByUserId: null,
  lastProviderStatus: null,
  lastRequestId: null,
  lastCheckedAt: null,
};

const ENV_READY_CONFIG: PhonePeStoredConfig = {
  pluginEnabled: true,
  oneTimeEnabled: true,
  autopayEnabled: true,
  webhookEnabled: true,
  updatedByUserId: "env-ready-fallback",
  lastProviderStatus: null,
  lastRequestId: null,
  lastCheckedAt: null,
};

function getPhonePeEnvironment(): "sandbox" | "production" {
  return process.env.PHONEPE_ENV?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

function readStoredConfig(value: Prisma.JsonValue | null | undefined): PhonePeStoredConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_CONFIG;
  }

  const record = value as Record<string, unknown>;
  return {
    pluginEnabled: record.pluginEnabled === true,
    oneTimeEnabled: record.oneTimeEnabled === true,
    autopayEnabled: record.autopayEnabled === true,
    webhookEnabled: record.webhookEnabled === true,
    updatedByUserId: typeof record.updatedByUserId === "string" ? record.updatedByUserId : null,
    lastProviderStatus: typeof record.lastProviderStatus === "string" ? record.lastProviderStatus : null,
    lastRequestId: typeof record.lastRequestId === "string" ? record.lastRequestId : null,
    lastCheckedAt: typeof record.lastCheckedAt === "string" ? record.lastCheckedAt : null,
  };
}

function readEnvStatus() {
  return [
    ...PHONEPE_REQUIRED_ENV_KEYS.map((key) => ({
      key,
      configured: Boolean(process.env[key]?.trim()),
      required: true,
    })),
    {
      key: "PHONEPE_CLIENT_SECRET_OR_API_KEY",
      configured: Boolean(process.env.PHONEPE_CLIENT_SECRET?.trim() || process.env.PHONEPE_API_KEY?.trim()),
      required: true,
    },
    ...PHONEPE_WEBHOOK_ENV_KEYS.map((key) => ({
      key,
      configured: Boolean(process.env[key]?.trim()),
      required: false,
    })),
    ...PHONEPE_OPTIONAL_ENV_KEYS.map((key) => ({
      key,
      configured: Boolean(process.env[key]?.trim()),
      required: false,
    })),
  ];
}

function canBuildUrls() {
  return Boolean(process.env.APP_BASE_URL?.trim());
}

export async function getPhonePeAdminConfig() {
  const environment = getPhonePeEnvironment();
  const providerConfig = await prisma.paymentProviderConfig.findUnique({
    where: {
      provider_environment: {
        provider: "PHONEPE",
        environment,
      },
    },
  });
  const envStatus = readEnvStatus();
  const missingEnvKeys = envStatus.filter((item) => item.required && !item.configured).map((item) => item.key);
  const missingWebhookEnvKeys = PHONEPE_WEBHOOK_ENV_KEYS.filter((key) => !process.env[key]?.trim());
  const envReady = missingEnvKeys.length === 0;
  const storedConfig = providerConfig ? readStoredConfig(providerConfig.config) : envReady ? ENV_READY_CONFIG : DEFAULT_CONFIG;
  const isActive = (providerConfig?.isActive ?? envReady) === true && storedConfig.pluginEnabled;
  const lastDiagnostic = await prisma.paymentLog.findFirst({
    where: { eventType: "PHONEPE_DIAGNOSTIC", payload: { path: ["environment"], equals: environment } },
    orderBy: { createdAt: "desc" }, select: { status: true, payload: true, createdAt: true },
  });
  const diagnosticPayload = lastDiagnostic?.payload && typeof lastDiagnostic.payload === "object" && !Array.isArray(lastDiagnostic.payload) ? lastDiagnostic.payload : {};

  return {
    environment,
    providerConfigId: providerConfig?.id ?? null,
    isActive,
    settings: storedConfig,
    envStatus,
    missingEnvKeys,
    missingWebhookEnvKeys,
    urls: canBuildUrls()
      ? buildPhonePeUrls()
      : {
          paymentWebhookUrl: "",
          subscriptionWebhookUrl: "",
          paymentReturnUrl: "",
          subscriptionReturnUrl: "",
        },
    updatedAt: providerConfig?.updatedAt?.toISOString() ?? null,
    readyForPayments: isActive && envReady,
    readyForAutopay: isActive && envReady && storedConfig.autopayEnabled && storedConfig.webhookEnabled && missingWebhookEnvKeys.length === 0,
    readyForOneTime: isActive && envReady && storedConfig.oneTimeEnabled && storedConfig.webhookEnabled && missingWebhookEnvKeys.length === 0,
    lastProviderStatus: lastDiagnostic?.status ?? null,
    lastRequestId: typeof diagnosticPayload.requestId === "string" ? diagnosticPayload.requestId : null,
    lastCheckedAt: lastDiagnostic?.createdAt.toISOString() ?? null,
  };
}

export async function updatePhonePeAdminConfig(input: PhonePeAdminSettingsInput & { updatedByUserId: string }) {
  const environment = getPhonePeEnvironment();
  const existing = await prisma.paymentProviderConfig.findUnique({
    where: { provider_environment: { provider: "PHONEPE", environment } },
  });
  const previous = readStoredConfig(existing?.config);
  const nextConfig: PhonePeStoredConfig = {
    pluginEnabled: input.pluginEnabled === true,
    oneTimeEnabled: input.oneTimeEnabled === true,
    autopayEnabled: input.autopayEnabled === true,
    webhookEnabled: input.webhookEnabled === true,
    updatedByUserId: input.updatedByUserId,
    lastProviderStatus: previous.lastProviderStatus,
    lastRequestId: previous.lastRequestId,
    lastCheckedAt: previous.lastCheckedAt,
  };

  await prisma.paymentProviderConfig.upsert({
    where: {
      provider_environment: {
        provider: "PHONEPE",
        environment,
      },
    },
    create: {
      provider: "PHONEPE",
      environment,
      isActive: nextConfig.pluginEnabled,
      config: nextConfig,
    },
    update: {
      isActive: nextConfig.pluginEnabled,
      config: nextConfig,
    },
  });

  return getPhonePeAdminConfig();
}

/** Diagnostics are separate from settings so failed requests cannot overwrite admin switches. */
export async function recordPhonePeProviderDiagnostic(input: { status: string; requestId: string }) {
  await prisma.paymentLog.create({ data: {
    eventType: "PHONEPE_DIAGNOSTIC",
    status: input.status.replace(/[^A-Z0-9_-]/gi, "").slice(0, 80),
    payload: { environment: getPhonePeEnvironment(), requestId: input.requestId.replace(/[^a-z0-9-]/gi, "").slice(0, 80) },
  } });
}

export async function assertPhonePeCapabilityEnabled(capability: PhonePeCapability) {
  const status = await getPhonePeAdminConfig();
  if (status.missingEnvKeys.length > 0) {
    throw new Error(`PhonePe server env keys missing: ${status.missingEnvKeys.join(", ")}.`);
  }

  if (capability === "webhook" && status.missingWebhookEnvKeys.length > 0) {
    throw new Error(`PhonePe webhook env keys missing: ${status.missingWebhookEnvKeys.join(", ")}.`);
  }

  if (!status.isActive) {
    throw new Error("PhonePe plugin switch is off in Billing Control.");
  }

  if (!status.readyForPayments) {
    throw new Error("PhonePe plugin is not fully configured. Enable PhonePe and complete server env keys in Super Admin > Billing Control.");
  }

  if (capability === "one_time" && !status.settings.oneTimeEnabled) {
    throw new Error("PhonePe one-time payments are disabled in Billing Control.");
  }

  if (capability === "autopay" && !status.settings.autopayEnabled) {
    throw new Error("PhonePe Autopay is disabled in Billing Control.");
  }

  if (capability === "webhook" && !status.settings.webhookEnabled) {
    throw new Error("PhonePe webhook processing is disabled in Billing Control.");
  }

  return status;
}
