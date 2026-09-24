import type { SessionUser } from "@/lib/auth/types";

const HEADER = {
  alg: "HS256",
  typ: "JWT",
};

const encoder = new TextEncoder();

function getTokenSecret() {
  return process.env.GIGXOMI_SESSION_SECRET?.trim() || "gigxomi-staging-session-secret";
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string) {
  return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToString(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

async function getSigningKey() {
  return crypto.subtle.importKey("raw", encoder.encode(getTokenSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(value: string) {
  const key = await getSigningKey();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createSessionToken(session: SessionUser) {
  const header = stringToBase64Url(JSON.stringify(HEADER));
  const payload = stringToBase64Url(JSON.stringify(session));
  const unsignedToken = `${header}.${payload}`;
  const signature = await sign(unsignedToken);
  return `${unsignedToken}.${signature}`;
}

export async function verifySessionToken(token?: string | null) {
  if (!token) {
    return null;
  }

  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) {
    return null;
  }

  const expectedSignature = await sign(`${header}.${payload}`);
  if (expectedSignature !== signature) {
    return null;
  }

  try {
    const raw = JSON.parse(base64UrlToString(payload)) as Partial<SessionUser>;
    if (!raw?.userId || !raw?.role || !raw?.phone) {
      return null;
    }

    const parsed: SessionUser = {
      userId: raw.userId,
      role: raw.role,
      assignedRole: raw.assignedRole ?? raw.role,
      tenantId: raw.tenantId ?? null,
      displayName: raw.displayName ?? "",
      email: raw.email ?? null,
      phone: raw.phone,
      packageId: raw.packageId ?? null,
      packageName: raw.packageName ?? null,
      packageAudience: raw.packageAudience ?? null,
      packageStatus: raw.packageStatus ?? null,
      packageExpiresAt: raw.packageExpiresAt ?? null,
      workspaceMode: raw.workspaceMode ?? null,
      sessionId: raw.sessionId ?? crypto.randomUUID(),
      expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : 0,
    };

    if (parsed.expiresAt <= Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
