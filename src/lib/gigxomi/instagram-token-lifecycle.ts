export const INSTAGRAM_LONG_LIVED_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;
export const INSTAGRAM_TOKEN_REFRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type InstagramTokenLifecycleStatus = "unknown" | "healthy" | "refresh-due" | "expired";

export function getInstagramTokenExpiresAt(expiresInSeconds: number, nowMs = Date.now()) {
  const normalizedExpiresIn = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
    ? expiresInSeconds
    : INSTAGRAM_LONG_LIVED_TOKEN_TTL_SECONDS;

  return new Date(nowMs + normalizedExpiresIn * 1000).toISOString();
}

export function getInstagramTokenLifecycleStatus(expiresAt?: string | null, nowMs = Date.now()): InstagramTokenLifecycleStatus {
  const expiresAtMs = Date.parse(String(expiresAt ?? "").trim());
  if (!Number.isFinite(expiresAtMs)) {
    return "unknown";
  }
  if (expiresAtMs <= nowMs) {
    return "expired";
  }
  if (expiresAtMs - nowMs <= INSTAGRAM_TOKEN_REFRESH_WINDOW_MS) {
    return "refresh-due";
  }
  return "healthy";
}

export function shouldRefreshInstagramToken(expiresAt?: string | null, nowMs = Date.now()) {
  return getInstagramTokenLifecycleStatus(expiresAt, nowMs) === "refresh-due";
}
