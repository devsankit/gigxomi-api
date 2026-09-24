import "server-only";

import type { DummyWhatsAppManualOverrideKey, DummyWhatsAppManualOverrides } from "@/lib/gigxomi/dummy-platform-store";

type MetaTokenExchangeSuccess = {
  ok: true;
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  debugExpiresAt?: string | null;
};

type MetaTokenExchangeFailure = {
  ok: false;
  error: string;
};

export type MetaTokenExchangeResult = MetaTokenExchangeSuccess | MetaTokenExchangeFailure;
export type MetaWebhookSubscriptionResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };
export type MetaPhoneRegistrationResult =
  | {
      ok: true;
      alreadyRegistered?: boolean;
      metaResponse?: {
        status: number;
        ok: boolean;
        payload: Record<string, unknown>;
      };
    }
  | {
      ok: false;
      error: string;
      metaResponse?: {
        status: number;
        ok: boolean;
        payload: Record<string, unknown>;
      };
    };

type MetaWhatsAppSetupSummarySuccess = {
  ok: true;
  businessId: string;
  businessPortfolioId: string;
  wabaId: string;
  phoneNumberId: string;
  phoneNumber: string;
  displayName: string;
  businessName: string;
  warnings: string[];
};

type MetaWhatsAppSetupSummaryFailure = {
  ok: false;
  error: string;
};

export type MetaWhatsAppSetupSummaryResult = MetaWhatsAppSetupSummarySuccess | MetaWhatsAppSetupSummaryFailure;

const META_WHATSAPP_MANUAL_OVERRIDE_KEYS: DummyWhatsAppManualOverrideKey[] = [
  "phoneNumber",
  "phoneNumberId",
  "wabaId",
  "businessPortfolioId",
  "businessId",
  "displayName",
  "businessName",
  "systemUserId",
];

function logWhatsAppOnboardingStep(step: string, payload?: unknown) {
  console.info(`[WHATSAPP_ONBOARDING] ${step}`, payload ?? {});
}

function buildMetaRegistrationResponse(response: Response, payload: Record<string, unknown>) {
  return {
    status: response.status,
    ok: response.ok,
    payload,
  };
}

function getMetaAppSecret() {
  return process.env.META_APP_SECRET?.trim() || process.env.FACEBOOK_APP_SECRET?.trim() || process.env.GIGXOMI_META_APP_SECRET?.trim() || "";
}

function normalizeGraphVersion(value?: string) {
  const version = value?.trim();
  return version?.startsWith("v") ? version : "v25.0";
}

function pickText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function preferMetaValue(fetched: unknown, ...fallbacks: unknown[]) {
  return pickText(fetched, ...fallbacks);
}

function normalizeManualOverrides(
  overrides?: Partial<Record<DummyWhatsAppManualOverrideKey, boolean>> | null,
): DummyWhatsAppManualOverrides {
  return META_WHATSAPP_MANUAL_OVERRIDE_KEYS.reduce<DummyWhatsAppManualOverrides>(
    (accumulator, key) => {
      accumulator[key] = Boolean(overrides?.[key]);
      return accumulator;
    },
    {
      phoneNumber: false,
      phoneNumberId: false,
      wabaId: false,
      businessPortfolioId: false,
      businessId: false,
      displayName: false,
      businessName: false,
      systemUserId: false,
    },
  );
}

function isSuspiciousPhoneNumberId(value: unknown, references: unknown[]) {
  const candidate = pickText(value);
  if (!candidate) {
    return false;
  }

  const normalizedReferences = new Set(references.map((reference) => pickText(reference)).filter(Boolean));
  return normalizedReferences.has(candidate);
}

function sanitizePhoneNumberId(value: unknown, references: unknown[]) {
  return isSuspiciousPhoneNumberId(value, references) ? "" : pickText(value);
}

function isAlreadyRegisteredPhoneError(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("already registered") ||
    normalized.includes("already been registered") ||
    normalized.includes("already connected") ||
    normalized.includes("already exists") ||
    normalized.includes("phone number is registered") ||
    normalized.includes("phone number has been registered")
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function dataArray(value: unknown) {
  const record = asRecord(value);
  if (record && Array.isArray(record.data)) {
    return record.data;
  }
  return asArray(value);
}

async function fetchMetaJson(accessToken: string, pathWithQuery: string, graphVersion: string) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${pathWithQuery}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  logWhatsAppOnboardingStep("META_GRAPH_RESPONSE", {
    request: {
      method: "GET",
      graphVersion,
      pathWithQuery,
      hasAccessToken: Boolean(accessToken),
    },
    response: {
      status: response.status,
      ok: response.ok,
      payload,
    },
  });

  if (!response.ok) {
    const errorPayload = asRecord(payload.error);
    return {
      ok: false as const,
      error:
        pickText(errorPayload?.error_user_msg, errorPayload?.message, payload.message) ||
        `Meta request failed for ${pathWithQuery}.`,
      payload,
    };
  }

  return {
    ok: true as const,
    payload,
  };
}

function selectPreferredPhoneRecord(
  records: unknown[],
  preferredPhoneNumberId?: string,
  preferredPhoneNumber?: string,
  options?: {
    allowFallback?: boolean;
  },
) {
  const normalizedPreferredId = pickText(preferredPhoneNumberId);
  const normalizedPreferredNumber = pickText(preferredPhoneNumber);
  const normalizedPreferredDigits = normalizedPreferredNumber.replace(/\D+/g, "");
  const candidates = records.map((record) => asRecord(record)).filter(Boolean) as Array<Record<string, unknown>>;

  if (normalizedPreferredId) {
    const exactIdMatch = candidates.find((record) => pickText(record.id) === normalizedPreferredId);
    if (exactIdMatch) {
      return {
        record: exactIdMatch,
        matchedPreferred: true,
        candidateCount: candidates.length,
      };
    }
  }

  if (normalizedPreferredDigits) {
    const exactNumberMatch = candidates.find((record) => pickText(record.display_phone_number).replace(/\D+/g, "") === normalizedPreferredDigits);
    if (exactNumberMatch) {
      return {
        record: exactNumberMatch,
        matchedPreferred: true,
        candidateCount: candidates.length,
      };
    }
  }

  if (options?.allowFallback === false) {
    return {
      record: null,
      matchedPreferred: false,
      candidateCount: candidates.length,
    };
  }

  return {
    record: candidates.length === 1 ? candidates[0] : null,
    matchedPreferred: false,
    candidateCount: candidates.length,
  };
}

async function fetchPhoneDetailsForWaba(
  accessToken: string,
  wabaId: string,
  graphVersion: string,
  options?: {
    preferredPhoneNumberId?: string;
    preferredPhoneNumber?: string;
    allowFallback?: boolean;
  },
) {
  if (!wabaId.trim()) {
    return {
      phoneNumberId: "",
      phoneNumber: "",
      displayName: "",
    };
  }

  const phoneResponse = await fetchMetaJson(
    accessToken,
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
    graphVersion,
  );

  if (!phoneResponse.ok) {
    return {
      phoneNumberId: "",
      phoneNumber: "",
      displayName: "",
    };
  }

  const phoneRecord = selectPreferredPhoneRecord(
    dataArray(phoneResponse.payload),
    options?.preferredPhoneNumberId,
    options?.preferredPhoneNumber,
    { allowFallback: options?.allowFallback },
  );
  return {
    phoneNumberId: pickText(phoneRecord.record?.id),
    phoneNumber: pickText(phoneRecord.record?.display_phone_number),
    displayName: pickText(phoneRecord.record?.verified_name),
    matchedPreferred: phoneRecord.matchedPreferred,
    candidateCount: phoneRecord.candidateCount,
  };
}

function selectPreferredWabaRecord(
  records: unknown[],
  preferredWabaId?: string,
  preferredPhoneNumberId?: string,
  preferredPhoneNumber?: string,
) {
  const normalizedPreferredWabaId = pickText(preferredWabaId);
  const normalizedPreferredPhoneNumberId = pickText(preferredPhoneNumberId);
  const normalizedPreferredDigits = pickText(preferredPhoneNumber).replace(/\D+/g, "");
  const candidates = records.map((record) => asRecord(record)).filter(Boolean) as Array<Record<string, unknown>>;

  if (normalizedPreferredWabaId) {
    const exactWabaMatch = candidates.find((record) => pickText(record.id) === normalizedPreferredWabaId);
    if (exactWabaMatch) {
      return exactWabaMatch;
    }
  }

  if (normalizedPreferredPhoneNumberId || normalizedPreferredDigits) {
    const exactPhoneMatch = candidates.find((record) =>
      dataArray(record.phone_numbers).some((phoneRecord) => {
        const normalizedPhoneRecord = asRecord(phoneRecord);
        return (
          (normalizedPreferredPhoneNumberId && pickText(normalizedPhoneRecord?.id) === normalizedPreferredPhoneNumberId) ||
          (normalizedPreferredDigits && pickText(normalizedPhoneRecord?.display_phone_number).replace(/\D+/g, "") === normalizedPreferredDigits)
        );
      }),
    );
    if (exactPhoneMatch) {
      return exactPhoneMatch;
    }
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function getWabaPhoneDetailsFromRecord(
  record: Record<string, unknown> | null,
  options?: {
    preferredPhoneNumberId?: string;
    preferredPhoneNumber?: string;
    allowFallback?: boolean;
  },
) {
  if (!record) {
    return {
      wabaId: "",
      phoneNumberId: "",
      phoneNumber: "",
      displayName: "",
      matchedPreferred: false,
      candidateCount: 0,
    };
  }

  const phoneRecord = selectPreferredPhoneRecord(
    dataArray(record.phone_numbers),
    options?.preferredPhoneNumberId,
    options?.preferredPhoneNumber,
    { allowFallback: options?.allowFallback },
  );

  return {
    wabaId: pickText(record.id),
    phoneNumberId: pickText(phoneRecord.record?.id),
    phoneNumber: pickText(phoneRecord.record?.display_phone_number),
    displayName: pickText(phoneRecord.record?.verified_name),
    matchedPreferred: phoneRecord.matchedPreferred,
    candidateCount: phoneRecord.candidateCount,
  };
}

async function fetchWabaDetailsById(
  accessToken: string,
  wabaId: string,
  graphVersion: string,
  options?: {
    preferredPhoneNumberId?: string;
    preferredPhoneNumber?: string;
    allowFallback?: boolean;
  },
) {
  const normalizedWabaId = wabaId.trim();
  if (!normalizedWabaId) {
    return null;
  }

  const wabaResponse = await fetchMetaJson(
    accessToken,
    `${normalizedWabaId}?fields=id,name,phone_numbers{id,display_phone_number,verified_name}`,
    graphVersion,
  );

  if (!wabaResponse.ok) {
    return null;
  }

  return getWabaPhoneDetailsFromRecord(asRecord(wabaResponse.payload), options);
}

async function fetchPhoneDetailsById(accessToken: string, phoneNumberId: string, graphVersion: string) {
  const normalizedPhoneNumberId = phoneNumberId.trim();
  if (!normalizedPhoneNumberId) {
    return {
      phoneNumberId: "",
      phoneNumber: "",
      displayName: "",
      wabaId: "",
    };
  }

  const phoneResponse = await fetchMetaJson(
    accessToken,
    `${normalizedPhoneNumberId}?fields=id,display_phone_number,verified_name,whatsapp_business_account{id,name}`,
    graphVersion,
  );

  if (!phoneResponse.ok) {
    return {
      phoneNumberId: normalizedPhoneNumberId,
      phoneNumber: "",
      displayName: "",
      wabaId: "",
    };
  }

  const phoneRecord = asRecord(phoneResponse.payload);
  const wabaRecord = asRecord(phoneRecord?.whatsapp_business_account);
  return {
    phoneNumberId: pickText(phoneRecord?.id, normalizedPhoneNumberId),
    phoneNumber: pickText(phoneRecord?.display_phone_number),
    displayName: pickText(phoneRecord?.verified_name),
    wabaId: pickText(wabaRecord?.id),
  };
}

async function debugToken(accessToken: string, appId: string, appSecret: string, graphVersion: string) {
  const appAccessToken = `${appId}|${appSecret}`;
  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: appAccessToken,
  });

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/debug_token?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: {
      expires_at?: number;
    };
  };

  if (!response.ok) {
    return null;
  }

  const expiresAt = payload.data?.expires_at;
  if (!expiresAt || expiresAt <= 0) {
    return null;
  }

  return new Date(expiresAt * 1000).toISOString();
}

async function exchangeAuthorizationCodeWithMeta(input: {
  appId: string;
  appSecret: string;
  authorizationCode: string;
  graphVersion: string;
  redirectUri?: string;
}) {
  const redirectCandidates = input.redirectUri?.trim() ? [input.redirectUri.trim(), ""] : [""];
  let firstPayload: Record<string, unknown> | null = null;
  let lastPayload: Record<string, unknown> = {};

  for (const redirectUri of redirectCandidates) {
    const body: Record<string, string> = {
      client_id: input.appId,
      client_secret: input.appSecret,
      grant_type: "authorization_code",
      code: input.authorizationCode,
    };

    if (redirectUri) {
      body.redirect_uri = redirectUri;
    }

    logWhatsAppOnboardingStep("STEP_4_TOKEN_EXCHANGE_STARTED", {
      request: {
        method: "POST",
        url: `https://graph.facebook.com/${input.graphVersion}/oauth/access_token`,
        body,
      },
    });
    logWhatsAppOnboardingStep("META_AUTH_EXCHANGE_START", {
      request: {
        method: "POST",
        url: `https://graph.facebook.com/${input.graphVersion}/oauth/access_token`,
        body,
      },
    });
    const postResponse = await fetch(`https://graph.facebook.com/${input.graphVersion}/oauth/access_token`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const postPayload = (await postResponse.json().catch(() => ({}))) as Record<string, unknown>;
    logWhatsAppOnboardingStep(postResponse.ok && pickText(postPayload.access_token) ? "STEP_5_TOKEN_EXCHANGE_SUCCESS" : "FAILED_AT_STEP_5_TOKEN_EXCHANGE", {
      request: {
        method: "POST",
        url: `https://graph.facebook.com/${input.graphVersion}/oauth/access_token`,
        body,
      },
      response: {
        status: postResponse.status,
        ok: postResponse.ok,
        payload: postPayload,
      },
    });
    logWhatsAppOnboardingStep(postResponse.ok && pickText(postPayload.access_token) ? "META_AUTH_EXCHANGE_SUCCESS" : "META_AUTH_EXCHANGE_FAILED", {
      request: {
        method: "POST",
        url: `https://graph.facebook.com/${input.graphVersion}/oauth/access_token`,
        body,
      },
      response: {
        status: postResponse.status,
        ok: postResponse.ok,
        payload: postPayload,
      },
    });
    firstPayload ??= postPayload;
    lastPayload = postPayload;
    if (postResponse.ok && pickText(postPayload.access_token)) {
      return {
        ok: true as const,
        payload: postPayload,
      };
    }
  }

  for (const redirectUri of redirectCandidates) {
    const params = new URLSearchParams({
      client_id: input.appId,
      client_secret: input.appSecret,
      code: input.authorizationCode,
    });

    if (redirectUri) {
      params.set("redirect_uri", redirectUri);
    }

    logWhatsAppOnboardingStep("STEP_4_TOKEN_EXCHANGE_STARTED", {
      request: {
        method: "GET",
        url: `https://graph.facebook.com/${input.graphVersion}/oauth/access_token?${params.toString()}`,
      },
    });
    logWhatsAppOnboardingStep("META_AUTH_EXCHANGE_START", {
      request: {
        method: "GET",
        url: `https://graph.facebook.com/${input.graphVersion}/oauth/access_token?${params.toString()}`,
      },
    });
    const getResponse = await fetch(`https://graph.facebook.com/${input.graphVersion}/oauth/access_token?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const getPayload = (await getResponse.json().catch(() => ({}))) as Record<string, unknown>;
    logWhatsAppOnboardingStep(getResponse.ok && pickText(getPayload.access_token) ? "STEP_5_TOKEN_EXCHANGE_SUCCESS" : "FAILED_AT_STEP_5_TOKEN_EXCHANGE", {
      request: {
        method: "GET",
        url: `https://graph.facebook.com/${input.graphVersion}/oauth/access_token?${params.toString()}`,
      },
      response: {
        status: getResponse.status,
        ok: getResponse.ok,
        payload: getPayload,
      },
    });
    logWhatsAppOnboardingStep(getResponse.ok && pickText(getPayload.access_token) ? "META_AUTH_EXCHANGE_SUCCESS" : "META_AUTH_EXCHANGE_FAILED", {
      request: {
        method: "GET",
        url: `https://graph.facebook.com/${input.graphVersion}/oauth/access_token?${params.toString()}`,
      },
      response: {
        status: getResponse.status,
        ok: getResponse.ok,
        payload: getPayload,
      },
    });
    lastPayload = getPayload;
    if (getResponse.ok && pickText(getPayload.access_token)) {
      return {
        ok: true as const,
        payload: getPayload,
      };
    }
  }

  return {
    ok: false as const,
    payload: lastPayload,
    fallbackPayload: firstPayload ?? lastPayload,
  };
}

export async function exchangeMetaAuthorizationCode(input: {
  appId: string;
  authorizationCode: string;
  graphApiVersion?: string;
  redirectUri?: string;
}) : Promise<MetaTokenExchangeResult> {
  const appId = input.appId.trim();
  const authorizationCode = input.authorizationCode.trim();
  const appSecret = getMetaAppSecret();
  const graphVersion = normalizeGraphVersion(input.graphApiVersion);
  const redirectUri = input.redirectUri?.trim() ?? "";

  if (!appId) {
    return {
      ok: false,
      error: "Meta app ID is missing. Save the WhatsApp setup app ID before refreshing the token.",
    };
  }

  if (!authorizationCode) {
    return {
      ok: false,
      error: "Authorization code is missing. Reconnect WhatsApp setup first so Meta returns a fresh code.",
    };
  }

  if (!appSecret) {
    return {
      ok: false,
      error: "META_APP_SECRET is not configured on the server. Add the Meta app secret before refreshing the access token.",
    };
  }

  const exchange = await exchangeAuthorizationCodeWithMeta({
    appId,
    appSecret,
    authorizationCode,
    graphVersion,
    redirectUri,
  });

  const payload = exchange.payload as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: {
      message?: string;
      error_user_msg?: string;
    };
  };

  if (!exchange.ok || !payload.access_token?.trim()) {
    const fallbackPayload = exchange.fallbackPayload as { error?: { message?: string; error_user_msg?: string }; message?: string } | undefined;
    return {
      ok: false,
      error:
        payload.error?.error_user_msg ||
        payload.error?.message ||
        fallbackPayload?.error?.error_user_msg ||
        fallbackPayload?.error?.message ||
        "Meta rejected the authorization code exchange.",
    };
  }

  const debugExpiresAt = await debugToken(payload.access_token, appId, appSecret, graphVersion).catch(() => null);

  return {
    ok: true,
    accessToken: payload.access_token.trim(),
    tokenType: payload.token_type,
    expiresIn: payload.expires_in,
    debugExpiresAt,
  };
}

export async function fetchMetaWhatsAppSetupSummary(input: {
  accessToken: string;
  graphApiVersion?: string;
  knownBusinessId?: string;
  knownBusinessPortfolioId?: string;
  knownWabaId?: string;
  knownPhoneNumberId?: string;
  knownPhoneNumber?: string;
  knownDisplayName?: string;
  knownBusinessName?: string;
  manualOverrides?: Partial<DummyWhatsAppManualOverrides>;
}): Promise<MetaWhatsAppSetupSummaryResult> {
  const accessToken = input.accessToken.trim();
  const graphVersion = normalizeGraphVersion(input.graphApiVersion);
  const manualOverrides = normalizeManualOverrides(input.manualOverrides);
  const warnings: string[] = [];

  if (!accessToken) {
    return {
      ok: false,
      error: "Access token is missing. Finish Meta signup first so Gigxomi can inspect the WhatsApp account details.",
    };
  }

  let businessId = input.knownBusinessId?.trim() ?? "";
  const businessPortfolioId = input.knownBusinessPortfolioId?.trim() ?? "";
  let businessName = input.knownBusinessName?.trim() ?? "";
  let wabaId = input.knownWabaId?.trim() ?? "";
  let phoneNumberId = sanitizePhoneNumberId(input.knownPhoneNumberId, [input.knownWabaId, input.knownBusinessId, input.knownBusinessPortfolioId]);
  let phoneNumber = input.knownPhoneNumber?.trim() ?? "";
  let displayName = input.knownDisplayName?.trim() ?? "";

  if (phoneNumberId) {
    const phoneDetails = await fetchPhoneDetailsById(accessToken, phoneNumberId, graphVersion);
    if (!manualOverrides.phoneNumberId || !phoneNumberId || isSuspiciousPhoneNumberId(phoneNumberId, [wabaId, businessId, businessPortfolioId])) {
      phoneNumberId = sanitizePhoneNumberId(phoneDetails.phoneNumberId, [wabaId, businessId, businessPortfolioId]);
    }
    if (!manualOverrides.phoneNumber || !phoneNumber) {
      phoneNumber = preferMetaValue(phoneDetails.phoneNumber, phoneNumber);
    }
    if (!manualOverrides.displayName || !displayName) {
      displayName = preferMetaValue(phoneDetails.displayName, displayName);
    }
    if (!manualOverrides.wabaId || !wabaId) {
      wabaId = preferMetaValue(phoneDetails.wabaId, wabaId);
    }
  }

  const businessesResponse = await fetchMetaJson(
    accessToken,
    "me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}",
    graphVersion,
  );

  if (businessesResponse.ok) {
    const businessRecords = dataArray(businessesResponse.payload).map((record) => asRecord(record)).filter(Boolean) as Array<Record<string, unknown>>;
    const businessRecord =
      businessRecords.find((record) => [businessId, businessPortfolioId].filter(Boolean).includes(pickText(record.id))) ??
      businessRecords.find((record) =>
        dataArray(record.owned_whatsapp_business_accounts).some((wabaRecord) => pickText(asRecord(wabaRecord)?.id) === wabaId),
      ) ??
      businessRecords[0];
    const ownedWabas = dataArray(businessRecord?.owned_whatsapp_business_accounts);
    const wabaRecord = selectPreferredWabaRecord(ownedWabas, wabaId, phoneNumberId, phoneNumber);
    const fetchedBusinessId = pickText(businessRecord?.id);
    const fetchedBusinessName = pickText(businessRecord?.name);
    const fetchedWabaId = pickText(wabaRecord?.id);
    const fetchedPhoneDetails = getWabaPhoneDetailsFromRecord(wabaRecord, {
      preferredPhoneNumberId: phoneNumberId,
      preferredPhoneNumber: phoneNumber,
      allowFallback: !manualOverrides.phoneNumberId && !manualOverrides.phoneNumber,
    });

    if (!manualOverrides.businessId || !businessId) {
      businessId = preferMetaValue(fetchedBusinessId, businessId);
    } else if (fetchedBusinessId && fetchedBusinessId !== businessId) {
      warnings.push("Gigxomi kept the manually saved Meta business ID instead of replacing it with the detected Meta value.");
    }

    if (!manualOverrides.businessName || !businessName) {
      businessName = preferMetaValue(fetchedBusinessName, businessName);
    } else if (fetchedBusinessName && fetchedBusinessName !== businessName) {
      warnings.push("Gigxomi kept the manually saved business name instead of replacing it with the detected Meta value.");
    }

    if (!manualOverrides.wabaId || !wabaId) {
      wabaId = preferMetaValue(fetchedWabaId, wabaId);
    } else if (fetchedWabaId && fetchedWabaId !== wabaId) {
      warnings.push("Gigxomi kept the manually saved WhatsApp Business Account ID instead of replacing it with the detected Meta value.");
    }

    if (!manualOverrides.phoneNumberId || !phoneNumberId || isSuspiciousPhoneNumberId(phoneNumberId, [wabaId, businessId, businessPortfolioId])) {
      phoneNumberId = preferMetaValue(fetchedPhoneDetails.phoneNumberId, phoneNumberId);
    }

    if (!manualOverrides.phoneNumber || !phoneNumber) {
      phoneNumber = preferMetaValue(fetchedPhoneDetails.phoneNumber, phoneNumber);
    }

    if (!manualOverrides.displayName || !displayName) {
      displayName = preferMetaValue(fetchedPhoneDetails.displayName, displayName);
    }
  }

  if (!wabaId) {
    const wabaResponses = await Promise.all([
      fetchMetaJson(
        accessToken,
        "me/owned_whatsapp_business_accounts?fields=id,name,phone_numbers{id,display_phone_number,verified_name}",
        graphVersion,
      ),
      fetchMetaJson(
        accessToken,
        "me/client_whatsapp_business_accounts?fields=id,name,phone_numbers{id,display_phone_number,verified_name}",
        graphVersion,
      ),
      fetchMetaJson(
        accessToken,
        "me/assigned_whatsapp_business_accounts?fields=id,name,phone_numbers{id,display_phone_number,verified_name}",
        graphVersion,
      ),
    ]);

    const wabaRecords = wabaResponses
      .filter((response) => response.ok)
      .flatMap((response) => dataArray(response.payload))
      .map((record) => asRecord(record))
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (wabaRecords.length) {
      const wabaRecord = selectPreferredWabaRecord(wabaRecords, input.knownWabaId?.trim(), phoneNumberId, phoneNumber);
      const fetchedWabaId = pickText(wabaRecord?.id);
      const fetchedPhoneDetails = getWabaPhoneDetailsFromRecord(wabaRecord, {
        preferredPhoneNumberId: phoneNumberId,
        preferredPhoneNumber: phoneNumber,
        allowFallback: !manualOverrides.phoneNumberId && !manualOverrides.phoneNumber,
      });

      if (!manualOverrides.wabaId || !wabaId) {
        wabaId = preferMetaValue(fetchedWabaId, wabaId);
      } else if (fetchedWabaId && fetchedWabaId !== wabaId) {
        warnings.push("Gigxomi kept the manually saved WhatsApp Business Account ID instead of replacing it with the detected Meta value.");
      }

      if (!manualOverrides.phoneNumberId || !phoneNumberId || isSuspiciousPhoneNumberId(phoneNumberId, [wabaId, businessId, businessPortfolioId])) {
        phoneNumberId = preferMetaValue(fetchedPhoneDetails.phoneNumberId, phoneNumberId);
      }

      if (!manualOverrides.phoneNumber || !phoneNumber) {
        phoneNumber = preferMetaValue(fetchedPhoneDetails.phoneNumber, phoneNumber);
      }

      if (!manualOverrides.displayName || !displayName) {
        displayName = preferMetaValue(fetchedPhoneDetails.displayName, displayName);
      }
    }
  }

  if (wabaId) {
    const keepManualLineSelection = manualOverrides.phoneNumberId || manualOverrides.phoneNumber;
    const directWabaDetails = await fetchWabaDetailsById(accessToken, wabaId, graphVersion, {
      preferredPhoneNumberId: phoneNumberId,
      preferredPhoneNumber: phoneNumber,
      allowFallback: !keepManualLineSelection,
    });
    const phoneDetails = directWabaDetails?.phoneNumberId
      ? directWabaDetails
      : await fetchPhoneDetailsForWaba(accessToken, wabaId, graphVersion, {
          preferredPhoneNumberId: phoneNumberId,
          preferredPhoneNumber: phoneNumber,
          allowFallback: !keepManualLineSelection,
        });

    if (keepManualLineSelection && (phoneNumberId || phoneNumber) && !phoneDetails.matchedPreferred) {
      warnings.push("Meta did not return the manually saved phone line for this WABA, so Gigxomi kept the manual phone number details instead of switching to a different line.");
    } else {
      if (!manualOverrides.phoneNumberId || !phoneNumberId || isSuspiciousPhoneNumberId(phoneNumberId, [wabaId, businessId, businessPortfolioId])) {
        phoneNumberId = preferMetaValue(phoneDetails.phoneNumberId, phoneNumberId);
      }

      if (!manualOverrides.phoneNumber || !phoneNumber) {
        phoneNumber = preferMetaValue(phoneDetails.phoneNumber, phoneNumber);
      }
    }

    if (!phoneDetails.phoneNumberId && phoneDetails.candidateCount && phoneDetails.candidateCount > 1) {
      warnings.push("Meta returned multiple WhatsApp phone numbers for this account but did not identify the selected line, so Gigxomi did not guess a phone number.");
    }

    if (!manualOverrides.displayName || !displayName) {
      displayName = preferMetaValue(phoneDetails.displayName, displayName);
    } else if (phoneDetails.displayName && phoneDetails.displayName !== displayName) {
      warnings.push("Gigxomi kept the manually saved display name instead of replacing it with the detected Meta verified name.");
    }

    phoneNumberId = sanitizePhoneNumberId(phoneNumberId, [wabaId, businessId, businessPortfolioId]);
  }

  if (phoneNumberId && (!phoneNumber || !displayName)) {
    const phoneDetails = await fetchPhoneDetailsById(accessToken, phoneNumberId, graphVersion);
    phoneNumber = preferMetaValue(phoneDetails.phoneNumber, phoneNumber);
    displayName = preferMetaValue(phoneDetails.displayName, displayName);
  }

  if (!businessName) {
    const meResponse = await fetchMetaJson(accessToken, "me?fields=id,name", graphVersion);
    if (meResponse.ok) {
      const meRecord = asRecord(meResponse.payload);
      businessName = preferMetaValue(meRecord?.name, businessName);
    }
  }

  if (!wabaId && !phoneNumberId && !businessId) {
    logWhatsAppOnboardingStep("FAILED_AT_STEP_6_WABA_FETCH", {
      businessId,
      businessPortfolioId,
      wabaId,
      phoneNumberId,
      phoneNumber,
      displayName,
      businessName,
      warnings,
    });
    return {
      ok: false,
      error:
        "Meta returned credentials, but Gigxomi could not inspect the WhatsApp account details yet. Finish the Meta number registration step and try Refresh access token once.",
    };
  }

  phoneNumberId = sanitizePhoneNumberId(phoneNumberId, [wabaId, businessId, businessPortfolioId]);
  if (businessId || wabaId) {
    logWhatsAppOnboardingStep("STEP_6_WABA_FETCH_SUCCESS", {
      business_id: businessId,
      business_portfolio_id: businessPortfolioId,
      waba_id: wabaId,
      business_name: businessName,
      warnings,
    });
    logWhatsAppOnboardingStep("META_WABA_DISCOVERED", {
      business_id: businessId,
      business_portfolio_id: businessPortfolioId,
      waba_id: wabaId,
      business_name: businessName,
      warnings,
    });
  }
  if (phoneNumberId) {
    logWhatsAppOnboardingStep("STEP_7_PHONE_NUMBER_FETCH_SUCCESS", {
      phone_number_id: phoneNumberId,
      display_phone_number: phoneNumber,
      display_name: displayName,
      warnings,
    });
    logWhatsAppOnboardingStep("META_PHONE_DISCOVERED", {
      phone_number_id: phoneNumberId,
      display_phone_number: phoneNumber,
      display_name: displayName,
      warnings,
    });
  } else {
    logWhatsAppOnboardingStep("FAILED_AT_STEP_7_PHONE_NUMBER_FETCH", {
      business_id: businessId,
      business_portfolio_id: businessPortfolioId,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      display_phone_number: phoneNumber,
      display_name: displayName,
      warnings,
    });
  }

  return {
    ok: true,
    businessId,
    businessPortfolioId,
    wabaId,
    phoneNumberId,
    phoneNumber,
    displayName,
    businessName,
    warnings,
  };
}

export async function subscribeAppToWhatsAppBusinessAccount(input: {
  accessToken: string;
  wabaId: string;
  graphApiVersion?: string;
}): Promise<MetaWebhookSubscriptionResult> {
  const accessToken = input.accessToken.trim();
  const wabaId = input.wabaId.trim();
  const graphVersion = normalizeGraphVersion(input.graphApiVersion);

  if (!accessToken) {
    return {
      ok: false,
      error: "Access token is missing. Save a working WhatsApp access token before subscribing the webhook app.",
    };
  }

  if (!wabaId) {
    return {
      ok: false,
      error: "WhatsApp Business Account ID is missing. Finish setup first so Gigxomi knows which account to subscribe.",
    };
  }

  const subscribeRequest = {
    method: "POST",
    url: `https://graph.facebook.com/${graphVersion}/${wabaId}/subscribed_apps`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: null,
    graphVersion,
    wabaId,
  };
  logWhatsAppOnboardingStep("WEBHOOK_SUBSCRIBE_REQUEST", subscribeRequest);

  let response: Response;
  try {
    response = await fetch(subscribeRequest.url, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    const failure = {
      request: subscribeRequest,
      error: error instanceof Error ? error.message : "Network request failed.",
    };
    logWhatsAppOnboardingStep("WEBHOOK_SUBSCRIBE_FAILED", failure);
    logWhatsAppOnboardingStep("FAILED_AT_STEP_9_WEBHOOK_SUBSCRIBE", failure);
    return {
      ok: false,
      error: failure.error,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: {
      message?: string;
      error_user_msg?: string;
    };
  };
  const subscribeResponse = {
    request: subscribeRequest,
    response: {
      status: response.status,
      ok: response.ok,
      payload,
    },
  };
  logWhatsAppOnboardingStep("WEBHOOK_SUBSCRIBE_RESPONSE", subscribeResponse);

  if (!response.ok || payload.success !== true) {
    logWhatsAppOnboardingStep("WEBHOOK_SUBSCRIBE_FAILED", subscribeResponse);
    logWhatsAppOnboardingStep("FAILED_AT_STEP_9_WEBHOOK_SUBSCRIBE", {
      request: subscribeRequest,
      response: subscribeResponse.response,
    });
    return {
      ok: false,
      error: payload.error?.error_user_msg || payload.error?.message || "Meta rejected the subscribed_apps request.",
    };
  }

  logWhatsAppOnboardingStep("STEP_9_WEBHOOK_SUBSCRIBE_SUCCESS", {
    request: subscribeRequest,
    response: subscribeResponse.response,
  });
  logWhatsAppOnboardingStep("META_WEBHOOK_SUBSCRIBE_SUCCESS", {
    request: subscribeRequest,
    response: subscribeResponse.response,
  });
  return { ok: true };
}

export async function registerWhatsAppPhoneNumber(input: {
  accessToken: string;
  phoneNumberId: string;
  pin?: string;
  graphApiVersion?: string;
}): Promise<MetaPhoneRegistrationResult> {
  const accessToken = input.accessToken.trim();
  const phoneNumberId = input.phoneNumberId.trim();
  const pin = input.pin?.trim() ?? "";
  const graphVersion = normalizeGraphVersion(input.graphApiVersion);

  if (!accessToken) {
    return {
      ok: false,
      error: "Access token is missing. Finish Meta signup first so Gigxomi can register this WhatsApp number.",
    };
  }

  if (!phoneNumberId) {
    return {
      ok: false,
      error: "Phone number ID is missing. Finish Meta signup first so Gigxomi knows which WhatsApp line to register.",
    };
  }

  const payload: Record<string, string> = {
    messaging_product: "whatsapp",
  };

  if (pin) {
    payload.pin = pin;
  }

  logWhatsAppOnboardingStep("META_PHONE_REGISTER_START", {
    request: {
      method: "POST",
      url: `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/register`,
      body: {
        messaging_product: payload.messaging_product,
        has_pin: Boolean(pin),
      },
    },
    graphVersion,
    phoneNumberId,
  });
  logWhatsAppOnboardingStep("REGISTER_PHONE_REQUEST", {
    request: {
      method: "POST",
      url: `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/register`,
      body: {
        messaging_product: payload.messaging_product,
        has_pin: Boolean(pin),
      },
    },
    graphVersion,
    phoneNumberId,
  });

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/register`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responsePayload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: {
      message?: string;
      error_user_msg?: string;
    };
  };
  const metaResponse = buildMetaRegistrationResponse(response, responsePayload as Record<string, unknown>);
  logWhatsAppOnboardingStep("REGISTER_PHONE_RESPONSE", {
    phoneNumberId,
    response: metaResponse,
  });

  if (!response.ok || responsePayload.success !== true) {
    const errorMessage =
      responsePayload.error?.error_user_msg ||
      responsePayload.error?.message ||
      "Meta rejected the phone number registration request.";

    if (isAlreadyRegisteredPhoneError(errorMessage)) {
      logWhatsAppOnboardingStep("META_PHONE_REGISTER_SUCCESS", {
        phoneNumberId,
        alreadyRegistered: true,
        response: metaResponse,
      });
      logWhatsAppOnboardingStep("REGISTER_PHONE_SUCCESS", {
        phoneNumberId,
        alreadyRegistered: true,
        response: metaResponse,
      });
      return { ok: true, alreadyRegistered: true, metaResponse };
    }

    logWhatsAppOnboardingStep("META_PHONE_REGISTER_FAILED", {
      phoneNumberId,
      error: errorMessage,
      response: metaResponse,
    });
    logWhatsAppOnboardingStep("REGISTER_PHONE_FAILED", {
      phoneNumberId,
      error: errorMessage,
      response: metaResponse,
    });
    return {
      ok: false,
      error: errorMessage,
      metaResponse,
    };
  }

  logWhatsAppOnboardingStep("META_PHONE_REGISTER_SUCCESS", {
    phoneNumberId,
    alreadyRegistered: false,
    response: metaResponse,
  });
  logWhatsAppOnboardingStep("REGISTER_PHONE_SUCCESS", {
    phoneNumberId,
    alreadyRegistered: false,
    response: metaResponse,
  });
  return { ok: true, metaResponse };
}
