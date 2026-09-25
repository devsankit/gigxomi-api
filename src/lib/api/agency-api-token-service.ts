import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const DEFAULT_PORTFOLIO_TOKEN_SCOPE = "team_portfolio:read";

export interface CreateAgencyTokenInput {
  tenantId: string;
  name: string;
  createdById: string;
  scopes?: string[];
  allowedOrigins?: string[];
}

export interface AgencyTokenDto {
  id: string;
  tenantId: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  allowedOrigins: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "ACTIVE" | "REVOKED";
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken.trim()).digest("hex");
}

export function generateRawToken(): string {
  // Prefix + 48 hex characters
  const secret = randomBytes(24).toString("hex");
  return `gx_tp_live_${secret}`;
}

export async function createAgencyToken(input: CreateAgencyTokenInput) {
  const { tenantId, name, createdById, scopes = [DEFAULT_PORTFOLIO_TOKEN_SCOPE], allowedOrigins = [] } = input;
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const tokenPrefix = `${rawToken.slice(0, 19)}...`;

  const record = await (prisma as any).appAgencyApiToken.create({
    data: {
      tenantId: tenantId.trim(),
      tokenHash,
      tokenPrefix,
      name: name.trim() || "Agency Studio Integration",
      scopes: [DEFAULT_PORTFOLIO_TOKEN_SCOPE],
      allowedOrigins: normalizeAllowedOrigins(allowedOrigins),
      createdById: createdById.trim(),
    },
  });

  return {
    rawToken,
    record: {
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      tokenPrefix: record.tokenPrefix,
      scopes: record.scopes,
      allowedOrigins: record.allowedOrigins || [],
      createdAt: record.createdAt.toISOString(),
      lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
      revokedAt: null,
      status: "ACTIVE" as const,
    },
  };
}

export async function verifyAgencyToken(
  bearerToken?: string | null,
  requiredScope: string = DEFAULT_PORTFOLIO_TOKEN_SCOPE,
  requestOrigin?: string | null,
) {
  if (!bearerToken || typeof bearerToken !== "string") {
    return { ok: false as const, error: "Missing or invalid bearer token", status: 401 };
  }

  const cleanToken = bearerToken.trim();
  if (!cleanToken.startsWith("gx_tp_live_")) {
    return { ok: false as const, error: "Malformed API token format", status: 401 };
  }

  const tokenHash = hashToken(cleanToken);

  const token = await (prisma as any).appAgencyApiToken.findUnique({
    where: { tokenHash },
  });

  if (!token) {
    return { ok: false as const, error: "Invalid API token", status: 401 };
  }

  if (token.revokedAt) {
    return { ok: false as const, error: "API token has been revoked", status: 401 };
  }

  if (requiredScope && Array.isArray(token.scopes) && !token.scopes.includes(requiredScope)) {
    return { ok: false as const, error: `Token lacks required scope: ${requiredScope}`, status: 403 };
  }

  const origin = requestOrigin?.trim();
  const allowedOrigins = Array.isArray(token.allowedOrigins) ? token.allowedOrigins : [];
  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    return { ok: false as const, error: "Origin is not allowed for this API token", status: 403 };
  }

  // Update lastUsedAt asynchronously without blocking
  (prisma as any).appAgencyApiToken
    .update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    ok: true as const,
    tenantId: token.tenantId,
    tokenRecord: token,
  };
}

export async function listAgencyTokens(tenantId: string): Promise<AgencyTokenDto[]> {
  const records = await (prisma as any).appAgencyApiToken.findMany({
    where: { tenantId: tenantId.trim() },
    orderBy: { createdAt: "desc" },
  });

  return records.map((record: any) => ({
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    scopes: record.scopes || [],
    allowedOrigins: record.allowedOrigins || [],
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
    status: record.revokedAt ? ("REVOKED" as const) : ("ACTIVE" as const),
  }));
}

function normalizeAllowedOrigins(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(value) || /^http:\/\/localhost(?::\d+)?$/.test(value)))).slice(0, 20);
}

export async function revokeAgencyToken(id: string, tenantId: string) {
  const result = await (prisma as any).appAgencyApiToken.updateMany({
    where: {
      id: id.trim(),
      tenantId: tenantId.trim(),
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return { ok: result.count > 0 };
}
