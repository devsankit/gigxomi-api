import "server-only";

import { normalizePhone } from "@/lib/auth/normalize";
import { getPublicAuthWhatsAppConfig } from "@/lib/auth/post-production-agency-config";
import { listWhatsAppConnectionStatesFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function resolvePublicAuthWhatsAppConnection() {
  const config = getPublicAuthWhatsAppConfig();
  const connections = await listWhatsAppConnectionStatesFromFile();
  const exactMatches = connections.filter((connection) => {
    if (!connection.pluginEnabled || normalizePhone(connection.phoneNumber) !== config.phone) return false;
    if (config.phoneNumberId && connection.phoneNumberId.trim() !== config.phoneNumberId) return false;
    return Boolean(
      connection.phoneNumberId.trim() &&
      connection.accessToken.trim(),
    );
  });

  if (config.tenantIdExplicit) {
    const tenantMatch = exactMatches.find((connection) => connection.tenantId === config.tenantId);
    if (tenantMatch) return tenantMatch;
  }

  // Never pick the first matching line when the identity is ambiguous. A
  // public OTP must fail closed rather than route a customer to another
  // tenant's WhatsApp account.
  return exactMatches.length === 1 ? exactMatches[0] : null;
}
