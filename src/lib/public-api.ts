function normalizeOrigin(value: string) {
  return value.replace(/\/+$/, "");
}

export function getPublicAppOrigin() {
  if (typeof window !== "undefined" && window.location.origin) {
    return normalizeOrigin(window.location.origin);
  }

  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredOrigin) {
    return normalizeOrigin(configuredOrigin);
  }

  return "http://localhost:3000";
}

export function getPublicApiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getPublicAppOrigin()}${normalizedPath}`;
}
