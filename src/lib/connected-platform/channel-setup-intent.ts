import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/prisma";

export type ChannelSetupChannel = "INSTAGRAM" | "WHATSAPP";
export const CHANNEL_SETUP_POLICY_VERSION = "2026-08-26";
const INTENT_TTL_MS = 10 * 60 * 1000;
export type ChannelSetupIntent = { intentId: string; userId: string; tenantId: string; channel: ChannelSetupChannel; expiresAt: number };
type RequestFingerprint = { ip?: string | null; userAgent?: string | null };

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function fingerprintHash(value: string | null | undefined) { return value?.trim() ? digest(value.trim()) : null; }

export function getRequestFingerprint(request: Request): RequestFingerprint {
  return {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
  };
}

export async function createChannelSetupIntent({ userId, tenantId, channel, fingerprint }: {
  userId: string;
  tenantId: string;
  channel: ChannelSetupChannel;
  fingerprint?: RequestFingerprint;
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INTENT_TTL_MS);
  const intentId = randomBytes(24).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const token = `${intentId}.${nonce}`;
  await prisma.$transaction([
    prisma.appChannelSetupIntent.updateMany({
      where: { userId, channel, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    }),
    prisma.appChannelSetupIntent.create({
      data: {
        id: intentId,
        tokenHash: digest(token),
        userId,
        tenantId,
        channel,
        policyVersion: CHANNEL_SETUP_POLICY_VERSION,
        policyAcceptedAt: now,
        createdIpHash: fingerprintHash(fingerprint?.ip),
        createdUserAgentHash: fingerprintHash(fingerprint?.userAgent),
        expiresAt,
      },
    }),
  ]);
  return token;
}

export async function verifyChannelSetupIntent(value: string): Promise<ChannelSetupIntent | null> {
  const [intentId, nonce, ...extra] = value.split(".");
  if (!intentId || !nonce || extra.length || intentId.length > 64 || nonce.length < 32 || nonce.length > 128) return null;
  const record = await prisma.appChannelSetupIntent.findUnique({ where: { id: intentId } });
  if (!record || record.expiresAt.getTime() <= Date.now()) return null;
  const supplied = Buffer.from(digest(value), "hex");
  const expected = Buffer.from(record.tokenHash, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  if (record.channel !== "INSTAGRAM" && record.channel !== "WHATSAPP") return null;
  return {
    intentId: record.id,
    userId: record.userId,
    tenantId: record.tenantId,
    channel: record.channel,
    expiresAt: record.expiresAt.getTime(),
  };
}

export async function consumeChannelSetupIntent(value: string, expected: ChannelSetupIntent, fingerprint?: RequestFingerprint) {
  const now = new Date();
  const consumed = await prisma.appChannelSetupIntent.updateMany({
    where: {
      id: expected.intentId,
      tokenHash: digest(value),
      userId: expected.userId,
      tenantId: expected.tenantId,
      channel: expected.channel,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      consumedAt: now,
      consumedIpHash: fingerprintHash(fingerprint?.ip),
      consumedUserAgentHash: fingerprintHash(fingerprint?.userAgent),
    },
  });
  return consumed.count === 1;
}
