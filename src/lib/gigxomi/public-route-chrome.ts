const INTERNAL_ROUTE_PREFIXES = [
  "/admin",
  "/chat",
  "/codedocs",
  "/editor",
  "/freelancer",
  "/manager",
  "/meta",
  "/mobile",
  "/sales",
  "/staging-health",
  "/super-admin",
] as const;

export function usesUnifiedPublicHeader(pathname: string) {
  return !INTERNAL_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
