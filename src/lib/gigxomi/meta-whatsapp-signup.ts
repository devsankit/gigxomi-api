const NESTED_META_KEYS = new Set(["data", "payload", "sessionInfo", "session_info", "extras"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseNestedJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function parseNestedJsonDeep(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  let current: unknown = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "string") {
      return current;
    }

    const parsed = parseNestedJson(current);
    if (!parsed) {
      return current;
    }

    current = parsed;
  }

  return current;
}

function collectStringFields(input: unknown, bag: Record<string, string>) {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    const nested = parseNestedJson(trimmed);
    if (nested) {
      collectStringFields(nested, bag);
    }
    return;
  }

  if (Array.isArray(input)) {
    input.forEach((item) => collectStringFields(item, bag));
    return;
  }

  const record = asRecord(input);
  if (!record) {
    return;
  }

  Object.entries(record).forEach(([key, value]) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && !bag[key]) {
        bag[key] = trimmed;
      }

      if (NESTED_META_KEYS.has(key)) {
        const nested = parseNestedJson(trimmed);
        if (nested) {
          collectStringFields(nested, bag);
        }
      }
      return;
    }

    if (value && typeof value === "object") {
      collectStringFields(value, bag);
    }
  });
}

function collectNamedRecords(input: unknown, keyHints: string[], matches: Array<Record<string, unknown>>) {
  if (Array.isArray(input)) {
    input.forEach((item) => collectNamedRecords(item, keyHints, matches));
    return;
  }

  const record = asRecord(input);
  if (!record) {
    return;
  }

  Object.entries(record).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    const nested = typeof value === "string" ? parseNestedJson(value) : value;
    const nestedRecord = asRecord(nested);
    const keyMatches = keyHints.some((hint) => normalizedKey.includes(hint));

    if (nestedRecord && keyMatches) {
      matches.push(nestedRecord);
    }

    if (Array.isArray(nested) && keyMatches) {
      nested.forEach((item) => {
        const itemRecord = asRecord(item);
        if (itemRecord) {
          matches.push(itemRecord);
        }
      });
    }

    if (nested && typeof nested === "object") {
      collectNamedRecords(nested, keyHints, matches);
    }
  });
}

export function pickMetaText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

export function extractMetaEmbeddedSignupData(input: unknown): Record<string, string> {
  const collected: Record<string, string> = {};
  const phoneRecords: Array<Record<string, unknown>> = [];
  const wabaRecords: Array<Record<string, unknown>> = [];
  const businessRecords: Array<Record<string, unknown>> = [];
  const normalizedInput = parseNestedJsonDeep(input);

  collectStringFields(normalizedInput, collected);
  collectNamedRecords(normalizedInput, ["phone"], phoneRecords);
  collectNamedRecords(normalizedInput, ["waba", "whatsapp_business"], wabaRecords);
  collectNamedRecords(normalizedInput, ["business"], businessRecords);

  const wrapper = asRecord(normalizedInput);
  const wrappedData = parseNestedJsonDeep(wrapper?.data);
  if (wrappedData && wrappedData !== normalizedInput) {
    collectStringFields(wrappedData, collected);
    collectNamedRecords(wrappedData, ["phone"], phoneRecords);
    collectNamedRecords(wrappedData, ["waba", "whatsapp_business"], wabaRecords);
    collectNamedRecords(wrappedData, ["business"], businessRecords);
  }

  const phoneRecord = phoneRecords[0] ?? {};
  const wabaRecord = wabaRecords[0] ?? {};
  const businessRecord = businessRecords[0] ?? {};

  const normalized = {
    business_id: pickMetaText(collected.business_id, collected.businessId, businessRecord.id),
    business_portfolio_id: pickMetaText(
      collected.business_portfolio_id,
      collected.businessPortfolioId,
      collected.business_manager_id,
      collected.businessManagerId,
    ),
    waba_id: pickMetaText(
      collected.waba_id,
      collected.wabaId,
      collected.whatsapp_business_account_id,
      collected.whatsappBusinessAccountId,
      wabaRecord.id,
    ),
    phone_number_id: pickMetaText(collected.phone_number_id, collected.phoneNumberId, phoneRecord.id),
    display_phone_number: pickMetaText(
      collected.display_phone_number,
      collected.phone_number,
      collected.phoneNumber,
      phoneRecord.display_phone_number,
      phoneRecord.phone_number,
      phoneRecord.phoneNumber,
    ),
    system_user_id: pickMetaText(collected.system_user_id, collected.systemUserId),
    display_name: pickMetaText(collected.display_name, collected.displayName),
    business_name: pickMetaText(collected.business_name, collected.businessName),
    code: pickMetaText(collected.code, collected.authorization_code, collected.authorizationCode),
    access_token: pickMetaText(collected.access_token, collected.accessToken),
  };

  return {
    ...collected,
    ...normalized,
  };
}
