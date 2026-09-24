import "server-only";

import { getPhonePeBaseUrl, getPhonePeConfig, getPhonePeOAuthUrl } from "@/lib/billing/phonepe-config";

type PhonePeTokenCache = {
  token: string;
  expiresAt: number;
};

let tokenCache: PhonePeTokenCache | null = null;

export class PhonePeRequestError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;
  readonly path: string;

  constructor(path: string, status: number, payload: Record<string, unknown>) {
    super(`PhonePe request ${path} failed with ${status}`);
    this.name = "PhonePeRequestError";
    this.path = path;
    this.status = status;
    this.payload = payload;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readNestedString(value: unknown, keys: string[]) {
  let current: unknown = value;
  for (const key of keys) {
    current = asRecord(current)[key];
  }
  return typeof current === "string" ? current : "";
}

function readNestedNumber(value: unknown, keys: string[]) {
  let current: unknown = value;
  for (const key of keys) {
    current = asRecord(current)[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

export class PhonePeHttpClient {
  private readonly config = getPhonePeConfig();
  private readonly baseUrl = getPhonePeBaseUrl(this.config.environment);
  private readonly tokenUrl = getPhonePeOAuthUrl(this.config.environment);

  private async getAccessToken() {
    if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
      return tokenCache.token;
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      client_version: this.config.clientVersion,
      grant_type: "client_credentials",
    });

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      throw new PhonePeRequestError("oauth/token", response.status, payload);
    }

    const token = readNestedString(payload, ["access_token"]) || readNestedString(payload, ["data", "access_token"]);
    const expiresAtSeconds = readNestedNumber(payload, ["expires_at"]) ?? readNestedNumber(payload, ["data", "expires_at"]);
    const expiresIn = Number(asRecord(payload).expires_in ?? asRecord(asRecord(payload).data).expires_in ?? 600);
    if (!token) {
      throw new Error("PhonePe OAuth response did not include an access token.");
    }

    tokenCache = {
      token,
      expiresAt: expiresAtSeconds ? expiresAtSeconds * 1000 : Date.now() + Math.max(60, expiresIn) * 1000,
    };
    return token;
  }

  async request(path: string, init?: RequestInit) {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `O-Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new PhonePeRequestError(path, response.status, payload);
    }
    return payload;
  }
}

export function readPhonePeRedirectUrl(payload: unknown) {
  return (
    readNestedString(payload, ["redirectUrl"]) ||
    readNestedString(payload, ["data", "redirectUrl"]) ||
    readNestedString(payload, ["data", "instrumentResponse", "redirectInfo", "url"]) ||
    readNestedString(payload, ["paymentUrl"]) ||
    readNestedString(payload, ["data", "paymentUrl"])
  );
}

export function readPhonePeState(payload: unknown) {
  return (
    readNestedString(payload, ["state"]) ||
    readNestedString(payload, ["data", "state"]) ||
    readNestedString(payload, ["payload", "state"]) ||
    readNestedString(payload, ["code"]) ||
    "UNKNOWN"
  );
}

export function readPhonePeReference(payload: unknown) {
  return (
    readNestedString(payload, ["transactionId"]) ||
    readNestedString(payload, ["data", "transactionId"]) ||
    readNestedString(payload, ["orderId"]) ||
    readNestedString(payload, ["data", "orderId"]) ||
    readNestedString(payload, ["subscriptionId"]) ||
    readNestedString(payload, ["data", "subscriptionId"])
  );
}
