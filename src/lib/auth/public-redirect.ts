import { NextResponse } from "next/server";

export function buildPublicRedirectPath(pathname: string, searchParams?: Record<string, string | null | undefined>) {
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized) {
      nextSearchParams.set(key, normalized);
    }
  }

  const query = nextSearchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function createPublicRedirect(pathname: string, searchParams?: Record<string, string | null | undefined>, status = 303) {
  return new NextResponse(null, {
    status,
    headers: {
      Location: buildPublicRedirectPath(pathname, searchParams),
    },
  });
}

export function sanitizePublicAuthError(error: unknown, fallback: string) {
  const rawMessage = error instanceof Error ? error.message.trim() : "";
  if (!rawMessage) {
    return fallback;
  }

  const normalized = rawMessage.toLowerCase();
  const blockedFragments = [
    "database_url",
    "prisma",
    "postgres",
    "pooler",
    "api_key",
    "econn",
    "enotfound",
    "connection",
    "ssl",
  ];

  if (blockedFragments.some((fragment) => normalized.includes(fragment))) {
    return fallback;
  }

  return rawMessage;
}
