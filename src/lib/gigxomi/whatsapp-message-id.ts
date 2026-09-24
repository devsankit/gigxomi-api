function decodeWhatsAppMessageId(value: string) {
  const encoded = value.trim().replace(/^wamid\./i, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!encoded) {
    return "";
  }

  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  try {
    return atob(padded);
  } catch {
    return "";
  }
}

export function getWhatsAppMessageIdFingerprint(value?: string | null) {
  const decoded = decodeWhatsAppMessageId(String(value ?? ""));
  if (!decoded) {
    return "";
  }

  const candidates = decoded.match(/[A-F0-9]{24,}/gi) ?? [];
  return candidates.at(-1)?.toUpperCase() ?? "";
}

export function whatsappMessageIdsMatch(left?: string | null, right?: string | null) {
  const normalizedLeft = String(left ?? "").trim();
  const normalizedRight = String(right ?? "").trim();
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftFingerprint = getWhatsAppMessageIdFingerprint(normalizedLeft);
  const rightFingerprint = getWhatsAppMessageIdFingerprint(normalizedRight);
  return Boolean(leftFingerprint && rightFingerprint && leftFingerprint === rightFingerprint);
}
