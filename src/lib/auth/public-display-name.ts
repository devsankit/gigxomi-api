const INVALID_PUBLIC_DISPLAY_NAME_CHARS = /[^\p{L}\s'.-]/gu;
const PUBLIC_DISPLAY_NAME_DIGITS = /\d/u;

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizePublicDisplayName(value: string) {
  return collapseWhitespace(String(value ?? "").replace(INVALID_PUBLIC_DISPLAY_NAME_CHARS, " "));
}

export function validatePublicDisplayName(value: string) {
  const rawValue = String(value ?? "");
  const collapsedRaw = collapseWhitespace(rawValue);
  const normalizedValue = normalizePublicDisplayName(rawValue);

  if (!normalizedValue) {
    return {
      ok: false as const,
      error: "Enter your full name to continue.",
    };
  }

  if (PUBLIC_DISPLAY_NAME_DIGITS.test(rawValue)) {
    return {
      ok: false as const,
      error: "Enter your full name using letters only. Numbers are not allowed.",
    };
  }

  if (normalizedValue !== collapsedRaw) {
    return {
      ok: false as const,
      error: "Enter your full name using letters only.",
    };
  }

  if (normalizedValue.split(" ").filter(Boolean).length < 2) {
    return {
      ok: false as const,
      error: "Enter your full first and last name to continue.",
    };
  }

  return {
    ok: true as const,
    value: normalizedValue,
  };
}

export function validatePublicNamePart(value: string, label: "first name" | "last name") {
  const rawValue = String(value ?? "");
  const collapsedRaw = collapseWhitespace(rawValue);
  const normalizedValue = normalizePublicDisplayName(rawValue);

  if (!normalizedValue) {
    return {
      ok: false as const,
      error: `Enter your ${label} to continue.`,
    };
  }

  if (PUBLIC_DISPLAY_NAME_DIGITS.test(rawValue)) {
    return {
      ok: false as const,
      error: `Enter your ${label} using letters only. Numbers are not allowed.`,
    };
  }

  if (normalizedValue !== collapsedRaw) {
    return {
      ok: false as const,
      error: `Enter your ${label} using letters only.`,
    };
  }

  return {
    ok: true as const,
    value: normalizedValue,
  };
}
