"use client";

import { getPublicApiUrl } from "@/lib/public-api";

type GrowthEventPayload = Record<string, unknown> & {
  event: string;
  path: string;
  url: string;
  referrer: string | null;
};

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    fbq?: (...args: unknown[]) => void;
    gigxomiMarketingConfig?: {
      pixelEndpoint?: string | null;
    };
  }
}

export function pushGrowthEvent(event: string, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const entry: GrowthEventPayload = {
    event,
    path: window.location.pathname,
    url: window.location.href,
    referrer: document.referrer || null,
    ...payload,
  };

  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(entry);

  if (typeof window.fbq === "function") {
    try {
      window.fbq("trackCustom", event, payload);
    } catch {
      // Ignore client-side pixel failures so public UX is never blocked.
    }
  }

  const body = JSON.stringify({
    event,
    path: entry.path,
    url: entry.url,
    referrer: entry.referrer,
    payload,
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(getPublicApiUrl("/api/public-growth/events"), blob);
  } else {
    void fetch(getPublicApiUrl("/api/public-growth/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body,
    }).catch(() => undefined);
  }

  const pixelEndpoint = window.gigxomiMarketingConfig?.pixelEndpoint?.trim();
  if (pixelEndpoint) {
    void fetch(pixelEndpoint, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body,
    }).catch(() => undefined);
  }
}
