// Shared pure policy: private application URLs and client-declared sales are forbidden.
export const META_CONSENT_COOKIE = "__Host-gx_meta_consent";
export const CLIENT_META_EVENTS = ["PageView", "ViewContent"] as const;
export type ConversionSource = "WEB" | "WEBINAR" | "WHATSAPP";
export type ConversionEventName = "PageView" | "ViewContent" | "Lead" | "CompleteRegistration" | "LeadSubmitted" | "Schedule" | "Purchase";

export function publicMetaUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    if (!["gigxomi.com", "www.gigxomi.com", "ankit.gigxomi.com"].includes(url.hostname)) return null;
    const path = url.pathname.replace(/\/$/, "") || "/";
    const publicPath = url.hostname === "ankit.gigxomi.com"
      ? ["/", "/webinar"].includes(path)
      : ["/", "/pricing", "/about", "/about-us", "/contact", "/services", "/blog", "/hire-editors"].includes(path)
        || /^\/(blog|services)\/[a-z0-9-]+$/.test(path);
    if (!publicPath) return null;
    // Pixel also reads the document URL: reject unexpected query keys before loading it.
    if ([...url.searchParams.keys()].some((key) => !["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].includes(key))) return null;
    return `${url.origin}${path}`;
  } catch { return null; }
}

export function websiteSource(url: string): ConversionSource {
  return new URL(url).hostname === "ankit.gigxomi.com" ? "WEBINAR" : "WEB";
}

export function hasMetaConsent(cookie: string | null) {
  const parts = (cookie ?? "").split(";").map((part) => part.trim());
  if (parts.some((part) => part === `${META_CONSENT_COOKIE}=denied`)) return false;
  return true;
}

export function validBrowserId(value: unknown) {
  return typeof value === "string" && /^fb\.\d+\.\d{10,13}\.[A-Za-z0-9_\-\.]{1,300}$/.test(value) ? value : undefined;
}

export function deliveryRetryDelay(attempt: number) {
  return Math.min(3600, 30 * 2 ** Math.min(attempt, 7)) * 1000;
}
