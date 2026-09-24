export type WhatsAppRoutingConnection = {
  tenantId: string;
  phoneNumberId?: string | null;
  phoneNumber?: string | null;
  updatedAt?: string | null;
};

function normalizeId(value: unknown) {
  return String(value ?? "").trim();
}

function phoneDigits(value: unknown) {
  return String(value ?? "").replace(/[^0-9]/g, "");
}

export function resolveWhatsAppWebhookConnection<T extends WhatsAppRoutingConnection>(
  connections: T[],
  metadata?: { phone_number_id?: string | null; display_phone_number?: string | null },
) {
  const phoneNumberId = normalizeId(metadata?.phone_number_id);
  const displayDigits = phoneDigits(metadata?.display_phone_number);
  const phoneNumberIdMatches = connections.filter(
    (candidate) => phoneNumberId && normalizeId(candidate.phoneNumberId) === phoneNumberId,
  );
  const displayNumberMatches = connections.filter(
    (candidate) => displayDigits && phoneDigits(candidate.phoneNumber) === displayDigits,
  );
  const candidates = phoneNumberIdMatches.length ? phoneNumberIdMatches : displayNumberMatches;
  const candidateTenantIds = new Set(candidates.map((candidate) => candidate.tenantId).filter(Boolean));
  if (candidateTenantIds.size !== 1) {
    return null;
  }

  return (
    candidates
      .slice()
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0] ?? null
  );
}
