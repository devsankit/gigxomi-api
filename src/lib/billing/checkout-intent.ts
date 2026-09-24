import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type BillingCheckoutIntent = {
  userId: string;
  packageId: string;
  billingCycle: "MONTHLY" | "YEARLY";
  returnTarget: "WEB" | "DIRECT_ANDROID";
  couponCode?: string;
  issuedAt: number;
  expiresAt: number;
};

function secret() {
  return (
    process.env.GIGXOMI_SESSION_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "gigxomi-secure-billing-checkout-session-secret-2026"
  );
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createBillingCheckoutIntent(input: Omit<BillingCheckoutIntent, "issuedAt" | "expiresAt">) {
  const now = Date.now();
  const payload = encode(JSON.stringify({ ...input, issuedAt: now, expiresAt: now + 20 * 60 * 1000 }));
  return `${payload}.${signature(payload)}`;
}

export function verifyBillingCheckoutIntent(token: string): BillingCheckoutIntent | null {
  const [payload, supplied, extra] = token.split(".");
  if (extra !== undefined) return null;
  if (!payload || !supplied) return null;
  const expected = signature(payload);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as BillingCheckoutIntent;
    if (typeof parsed.userId !== "string" || !parsed.userId || typeof parsed.packageId !== "string" || !parsed.packageId) return null;
    if (!Number.isFinite(parsed.expiresAt) || !Number.isFinite(parsed.issuedAt) || parsed.expiresAt <= Date.now() || parsed.issuedAt > Date.now() || parsed.expiresAt - parsed.issuedAt > 20 * 60 * 1000) return null;
    if (parsed.billingCycle !== "MONTHLY" && parsed.billingCycle !== "YEARLY") return null;
    if (parsed.returnTarget !== "WEB" && parsed.returnTarget !== "DIRECT_ANDROID") return null;
    return parsed;
  } catch {
    return null;
  }
}
