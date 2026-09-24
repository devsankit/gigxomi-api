import "server-only";

const WEBINAR_GG_API_BASE_URL = "https://webinar-api.webinar.gg/api/v1";

type WebinarGgApiResponse<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

function configuration() {
  return {
    token: process.env.WEBINAR_GG_API_TOKEN?.trim() || "",
    webinarId: process.env.WEBINAR_GG_WEBINAR_ID?.trim() || "",
  };
}

async function webinarGgRequest<T>(path: string, init?: RequestInit) {
  const { token } = configuration();
  if (!token) throw new Error("WEBINAR_GG_API_TOKEN is not configured.");

  const response = await fetch(`${WEBINAR_GG_API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as WebinarGgApiResponse<T>;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `Webinar.gg request failed with HTTP ${response.status}.`);
  }
  return payload.data;
}

export function getConfiguredWebinarGgId() {
  return configuration().webinarId;
}

export function buildWebinarGgJoinUrl(webinarId: string) {
  return `https://webinar.gg/webinar-page/${encodeURIComponent(webinarId)}`;
}

export async function verifyOwnedWebinarGgEvent(webinarId: string) {
  const configuredId = getConfiguredWebinarGgId();
  if (!configuredId) throw new Error("WEBINAR_GG_WEBINAR_ID is not configured.");
  if (configuredId !== webinarId) throw new Error("Webhook webinar does not match the configured Gigxomi webinar.");
  await webinarGgRequest(`/webinar/${encodeURIComponent(webinarId)}`);
}

export async function inviteWebinarGgAttendee(email: string) {
  const webinarId = getConfiguredWebinarGgId();
  const normalizedEmail = email.trim().toLowerCase();
  if (!webinarId || !normalizedEmail) return { ok: false as const, skipped: true as const };

  await webinarGgRequest<{ message?: string }>(`/webinar/${encodeURIComponent(webinarId)}/invite`, {
    body: JSON.stringify({ emails: [normalizedEmail] }),
    method: "POST",
  });
  return { ok: true as const, skipped: false as const };
}
