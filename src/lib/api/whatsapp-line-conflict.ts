import "server-only";

import { listWhatsAppConnectionStatesFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhone(value: unknown) {
  return text(value).replace(/\D/g, "");
}

export async function findWhatsAppLineConflict(
  ownerTenantId: string,
  input: {
    phoneNumber?: unknown;
    phoneNumberId?: unknown;
    wabaId?: unknown;
  },
) {
  const phoneNumber = normalizePhone(input.phoneNumber);
  const phoneNumberId = text(input.phoneNumberId);
  const wabaId = text(input.wabaId);

  if (!phoneNumber && !phoneNumberId && !wabaId) {
    return null;
  }

  const states = await listWhatsAppConnectionStatesFromFile();
  return (
    states.find((state) => {
      if (state.tenantId === ownerTenantId) return false;
      const samePhoneNumber = phoneNumber && normalizePhone(state.phoneNumber) === phoneNumber;
      const samePhoneNumberId = phoneNumberId && text(state.phoneNumberId) === phoneNumberId;
      const sameWabaId = wabaId && text(state.wabaId) === wabaId;
      return Boolean(samePhoneNumber || samePhoneNumberId || sameWabaId);
    }) ?? null
  );
}
