function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

function getFirstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() ?? "";
}

function sanitizeHost(value: string) {
  return value.replace(/^(https?:)?\/\//i, "").replace(/\/.*$/, "").trim();
}

function sanitizeProto(value: string) {
  const normalized = value.toLowerCase().replace(/:$/, "").trim();
  return normalized === "http" || normalized === "https" ? normalized : "";
}

export function getPublicRequestOrigin(request: Request) {
  const forwardedHost = sanitizeHost(getFirstHeaderValue(request.headers.get("x-forwarded-host")));
  const forwardedProto = sanitizeProto(getFirstHeaderValue(request.headers.get("x-forwarded-proto")));

  if (forwardedHost && forwardedProto) {
    return normalizeBaseUrl(`${forwardedProto}://${forwardedHost}`);
  }

  const requestHost = sanitizeHost(getFirstHeaderValue(request.headers.get("host")));
  if (requestHost) {
    const inferredProto = forwardedProto || (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(requestHost) ? "http" : "https");
    return normalizeBaseUrl(`${inferredProto}://${requestHost}`);
  }

  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredOrigin) {
    return normalizeBaseUrl(configuredOrigin);
  }

  const requestOrigin = new URL(request.url).origin;
  if (requestOrigin) {
    return normalizeBaseUrl(requestOrigin);
  }

  return "http://localhost:3000";
}

export function getPublicRequestUrl(request: Request, path: string) {
  try {
    return new URL(path, `${getPublicRequestOrigin(request)}/`);
  } catch {
    return new URL(path, `${normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000")}/`);
  }
}
