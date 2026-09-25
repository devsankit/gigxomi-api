import "server-only";

import crypto from "node:crypto";

export interface InternalAgencyAssertion {
  subjectUserId: string;
  tenantId: string;
  audience: "agency-sites";
  issuedAt: number;
  expiresAt: number;
  nonce?: string;
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyInternalAgencyAssertion(value: string | null) {
  const secret = process.env.GIGXOMI_INTERNAL_API_SECRET?.trim();
  if (!secret || !value) return { ok: false as const, error: "Internal assertion is not configured" };

  const [encoded, signature] = value.trim().split(".");
  if (!encoded || !signature) return { ok: false as const, error: "Malformed internal assertion" };

  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  if (!constantTimeEqual(signature, expected)) return { ok: false as const, error: "Invalid internal assertion" };

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as InternalAgencyAssertion;
    const now = Math.floor(Date.now() / 1000);
    if (
      payload.audience !== "agency-sites" ||
      !payload.subjectUserId ||
      !payload.tenantId ||
      !Number.isFinite(payload.issuedAt) ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= now ||
      payload.issuedAt > now + 30
    ) {
      return { ok: false as const, error: "Expired or invalid internal assertion" };
    }
    return { ok: true as const, assertion: payload };
  } catch {
    return { ok: false as const, error: "Invalid internal assertion payload" };
  }
}
