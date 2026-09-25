import "server-only";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const buckets = new Map<string, { startedAt: number; count: number }>();

export function checkTeamPortfolioRateLimit(key: string) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count <= MAX_REQUESTS) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.ceil((WINDOW_MS - (now - current.startedAt)) / 1000) };
}
