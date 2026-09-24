import "server-only";

import { normalizePhone } from "@/lib/auth/normalize";

export const POST_PRODUCTION_AGENCY_DISPLAY_NAME = "Post Production Work Dewas";
export const POST_PRODUCTION_AGENCY_EMAIL = "postproductionworkdewas@gmail.com";
export const POST_PRODUCTION_AGENCY_PHONE = "+919981807309";
export const POST_PRODUCTION_AGENCY_PACKAGE_ID = "pkg-agency-scale";
export const POST_PRODUCTION_AGENCY_DEFAULT_TENANT_ID = "tenant-agency-post-production-work-dewas";
export const POST_PRODUCTION_AGENCY_FIXED_OTP_PERMISSION = "post_production_fixed_otp";

export const PUBLIC_AUTH_WHATSAPP_TENANT_ENV = "GIGXOMI_PUBLIC_AUTH_WHATSAPP_TENANT_ID";
export const PUBLIC_AUTH_WHATSAPP_NUMBER_ENV = "GIGXOMI_PUBLIC_AUTH_WHATSAPP_NUMBER";
export const PUBLIC_AUTH_WHATSAPP_PHONE_NUMBER_ID_ENV = "GIGXOMI_PUBLIC_AUTH_WHATSAPP_PHONE_NUMBER_ID";
export const FIXED_AGENCY_OTP_HASH_ENV = "GIGXOMI_POST_PRODUCTION_FIXED_OTP_HASH";

export function isPostProductionAgencyIdentity(input: {
  phone?: string | null;
  email?: string | null;
  permissions?: string[] | null;
}) {
  const phoneMatches = normalizePhone(input.phone ?? "") === POST_PRODUCTION_AGENCY_PHONE;
  const emailMatches = String(input.email ?? "").trim().toLowerCase() === POST_PRODUCTION_AGENCY_EMAIL;
  const hasPermission = input.permissions?.includes(POST_PRODUCTION_AGENCY_FIXED_OTP_PERMISSION) ?? false;
  return phoneMatches || (emailMatches && hasPermission);
}

export function getPostProductionFixedOtpHash() {
  const configured = process.env[FIXED_AGENCY_OTP_HASH_ENV]?.trim().toLowerCase() ?? "";
  return /^[a-f0-9]{64}$/.test(configured) ? configured : "";
}

export function getPublicAuthWhatsAppTenantId() {
  return process.env[PUBLIC_AUTH_WHATSAPP_TENANT_ENV]?.trim() || POST_PRODUCTION_AGENCY_DEFAULT_TENANT_ID;
}

export function getPublicAuthWhatsAppConfig() {
  return {
    tenantId: getPublicAuthWhatsAppTenantId(),
    tenantIdExplicit: Boolean(process.env[PUBLIC_AUTH_WHATSAPP_TENANT_ENV]?.trim()),
    phone: normalizePhone(process.env[PUBLIC_AUTH_WHATSAPP_NUMBER_ENV] ?? POST_PRODUCTION_AGENCY_PHONE),
    phoneNumberId: process.env[PUBLIC_AUTH_WHATSAPP_PHONE_NUMBER_ID_ENV]?.trim() ?? "",
  };
}
