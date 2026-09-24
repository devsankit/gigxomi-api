import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";

export type ManualUpiAdminSettingsInput = {
  pluginEnabled?: boolean;
  upiId?: string;
  payeeName?: string;
  supportWhatsApp?: string;
  instructions?: string;
};

type ManualUpiConfigSource = "db" | "env" | "none";

type ManualUpiStoredConfig = {
  pluginEnabled: boolean;
  upiId: string;
  payeeName: string;
  supportWhatsApp: string;
  instructions: string;
  updatedByUserId?: string | null;
};

const PROVIDER = "UPI_MANUAL";
const ENVIRONMENT = "manual";

const DEFAULT_CONFIG: ManualUpiStoredConfig = {
  pluginEnabled: false,
  upiId: "",
  payeeName: "Gigxomi",
  supportWhatsApp: companyKnowledgeBase.supportPhoneE164,
  instructions: "Pay the exact package amount, then send the payment screenshot or UTR on WhatsApp for approval.",
  updatedByUserId: null,
};

function readEnvConfig(): ManualUpiStoredConfig {
  const rawEnabled = process.env.MANUAL_UPI_ENABLED?.trim().toLowerCase();
  const upiId = process.env.MANUAL_UPI_ID?.trim() || process.env.UPI_ID?.trim() || "";
  return {
    pluginEnabled: rawEnabled ? rawEnabled !== "false" && rawEnabled !== "0" && rawEnabled !== "off" : Boolean(upiId),
    upiId,
    payeeName: process.env.MANUAL_UPI_PAYEE_NAME?.trim() || process.env.UPI_PAYEE_NAME?.trim() || DEFAULT_CONFIG.payeeName,
    supportWhatsApp:
      normalizeWhatsApp(process.env.MANUAL_UPI_SUPPORT_WHATSAPP?.trim() || process.env.UPI_SUPPORT_WHATSAPP?.trim() || "") ||
      DEFAULT_CONFIG.supportWhatsApp,
    instructions: process.env.MANUAL_UPI_INSTRUCTIONS?.trim() || DEFAULT_CONFIG.instructions,
    updatedByUserId: "env-fallback",
  };
}

function mergeConfigWithEnv(stored: ManualUpiStoredConfig, envConfig: ManualUpiStoredConfig) {
  return {
    pluginEnabled: stored.pluginEnabled || envConfig.pluginEnabled,
    upiId: stored.upiId || envConfig.upiId,
    payeeName: stored.payeeName || envConfig.payeeName,
    supportWhatsApp: stored.supportWhatsApp || envConfig.supportWhatsApp,
    instructions: stored.instructions || envConfig.instructions,
    updatedByUserId: stored.updatedByUserId || envConfig.updatedByUserId,
  };
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function readStoredConfig(value: Prisma.JsonValue | null | undefined): ManualUpiStoredConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_CONFIG;
  }

  const record = value as Record<string, unknown>;
  return {
    pluginEnabled: record.pluginEnabled === true,
    upiId: readString(record.upiId),
    payeeName: readString(record.payeeName, DEFAULT_CONFIG.payeeName),
    supportWhatsApp: readString(record.supportWhatsApp, DEFAULT_CONFIG.supportWhatsApp),
    instructions: readString(record.instructions, DEFAULT_CONFIG.instructions),
    updatedByUserId: readString(record.updatedByUserId, "") || null,
  };
}

function normalizeWhatsApp(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("91") ? `+${digits}` : digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

export async function getManualUpiAdminConfig() {
  const envConfig = readEnvConfig();
  const providerConfig = await prisma.paymentProviderConfig.findUnique({
    where: {
      provider_environment: {
        provider: PROVIDER,
        environment: ENVIRONMENT,
      },
    },
  });
  const storedSettings = providerConfig ? readStoredConfig(providerConfig.config) : DEFAULT_CONFIG;
  const settings = mergeConfigWithEnv(storedSettings, envConfig);
  const missingFields = [
    settings.upiId ? null : "UPI ID",
    settings.payeeName ? null : "Payee name",
    settings.supportWhatsApp ? null : "WhatsApp support number",
  ].filter(Boolean) as string[];
  const isActive = ((providerConfig?.isActive ?? false) && storedSettings.pluginEnabled) || envConfig.pluginEnabled;
  const configSource: ManualUpiConfigSource = providerConfig ? "db" : envConfig.pluginEnabled ? "env" : "none";

  return {
    environment: ENVIRONMENT,
    providerConfigId: providerConfig?.id ?? null,
    isActive,
    settings,
    missingFields,
    configSource,
    envFallbackActive: envConfig.pluginEnabled,
    updatedAt: providerConfig?.updatedAt?.toISOString() ?? null,
    readyForPayments: isActive && missingFields.length === 0,
  };
}

export async function updateManualUpiAdminConfig(input: ManualUpiAdminSettingsInput & { updatedByUserId: string }) {
  const existing = await getManualUpiAdminConfig();
  const nextConfig: ManualUpiStoredConfig = {
    pluginEnabled: input.pluginEnabled === true,
    upiId: readString(input.upiId, existing.settings.upiId),
    payeeName: readString(input.payeeName, existing.settings.payeeName || DEFAULT_CONFIG.payeeName),
    supportWhatsApp: normalizeWhatsApp(readString(input.supportWhatsApp, existing.settings.supportWhatsApp || DEFAULT_CONFIG.supportWhatsApp)),
    instructions: readString(input.instructions, existing.settings.instructions || DEFAULT_CONFIG.instructions),
    updatedByUserId: input.updatedByUserId,
  };

  await prisma.paymentProviderConfig.upsert({
    where: {
      provider_environment: {
        provider: PROVIDER,
        environment: ENVIRONMENT,
      },
    },
    create: {
      provider: PROVIDER,
      environment: ENVIRONMENT,
      isActive: nextConfig.pluginEnabled,
      config: nextConfig,
    },
    update: {
      isActive: nextConfig.pluginEnabled,
      config: nextConfig,
    },
  });

  return getManualUpiAdminConfig();
}

export async function assertManualUpiReady() {
  const config = await getManualUpiAdminConfig();
  if (!config.readyForPayments) {
    const missing = config.missingFields.length ? ` Missing: ${config.missingFields.join(", ")}.` : "";
    throw new Error(`Manual UPI payment is not configured in Super Admin > Billing Control.${missing}`);
  }
  return config;
}

export function buildUpiPaymentUri(input: {
  amount: number;
  currency?: string | null;
  note: string;
  payeeName: string;
  transactionReference?: string | null;
  upiId: string;
}) {
  const params = new URLSearchParams();
  params.set("pa", input.upiId);
  params.set("pn", input.payeeName);
  params.set("am", input.amount.toFixed(2));
  params.set("cu", input.currency || "INR");
  params.set("tn", input.note);
  if (input.transactionReference?.trim()) {
    params.set("tr", input.transactionReference.trim());
  }
  return `upi://pay?${params.toString()}`;
}

export function buildWhatsAppHref(input: { phone: string; message: string }) {
  const digits = input.phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(input.message)}`;
}
