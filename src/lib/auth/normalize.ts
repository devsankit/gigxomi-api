import "server-only";

export function getPhoneDigits(value: string) {
  return String(value ?? "").replace(/[^\d]/g, "");
}

export function normalizePhone(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  if (raw.startsWith("+")) {
    const digits = getPhoneDigits(raw);
    return digits ? `+${digits}` : "";
  }

  const digits = getPhoneDigits(raw);
  if (!digits) {
    return "";
  }

  if (digits.startsWith("00") && digits.length > 2) {
    return `+${digits.slice(2)}`;
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    return `+91${digits.slice(1)}`;
  }

  if (digits.length <= 10) {
    return `+91${digits}`;
  }

  return `+${digits}`;
}

export function normalizeIdentifier(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.includes("@") ? trimmed.toLowerCase() : normalizePhone(trimmed);
}

export function normalizePhoneList(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizePhone(value ?? "")).filter(Boolean)));
}

