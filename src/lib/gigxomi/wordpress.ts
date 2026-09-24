import { unstable_cache } from "next/cache";

import type { WordPressServiceResponse } from "./types";

const DEFAULT_API_BASE = "https://blog.gigxomi.com/wp-json/gigxomi/v1";
const WORDPRESS_TIMEOUT_MS = 10_000;
const WORDPRESS_REVALIDATE_SECONDS = 300;
const WORDPRESS_FAILURE_COOLDOWN_MS = 60_000;

let servicesFailureRetryAfter = 0;

function getWordPressApiBase() {
  const rawValue = process.env.GIGXOMI_WORDPRESS_API_BASE?.trim();
  if (!rawValue) {
    return DEFAULT_API_BASE;
  }

  if (rawValue.endsWith("/gigxomi/v1")) {
    return rawValue;
  }

  if (rawValue.endsWith("/wp-json")) {
    return `${rawValue}/gigxomi/v1`;
  }

  return rawValue;
}

function getEmptyWordPressResponse(): WordPressServiceResponse {
  return {
    count: 0,
    items: [],
  };
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORDPRESS_TIMEOUT_MS);

  try {
    return await fetch(url, {
      next: { revalidate: 300 },
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWordPressServicesFresh(): Promise<WordPressServiceResponse> {
  if (Date.now() < servicesFailureRetryAfter) {
    throw new Error("WordPress services are temporarily cooling down after a failed fetch.");
  }

  try {
    const response = await fetchWithTimeout(`${getWordPressApiBase()}/services`);

    if (!response.ok) {
      throw new Error(`Failed to fetch WordPress services: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    servicesFailureRetryAfter = Date.now() + WORDPRESS_FAILURE_COOLDOWN_MS;
    console.warn("Falling back to empty WordPress services:", error instanceof Error ? error.message : String(error));
    return getEmptyWordPressResponse();
  }
}

export const fetchWordPressServices = unstable_cache(fetchWordPressServicesFresh, ["gigxomi-wordpress-services"], {
  revalidate: WORDPRESS_REVALIDATE_SECONDS,
});

export async function fetchWordPressService(serviceId: number) {
  const response = await fetchWithTimeout(`${getWordPressApiBase()}/services/${serviceId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch service ${serviceId}: ${response.status}`);
  }

  return response.json();
}
