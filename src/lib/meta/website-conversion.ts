import "server-only";
import { isIP } from "node:net";
import { hasMetaConsent, publicMetaUrl, validBrowserId } from "./conversion-contract";

export function websiteConversionContext(request: Request, sourceUrl: string) {
  if (!hasMetaConsent(request.headers.get("cookie"))) return null;
  if (request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1") return null;
  const url = publicMetaUrl(sourceUrl);
  if (!url) return null;
  const origin = request.headers.get("origin");
  if (!origin || new URL(url).origin !== origin) return null;
  const cookie = (name: string) => {
    const pair = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return validBrowserId(pair?.slice(name.length + 1));
  };
  // Nginx appends the peer to X-Forwarded-For. Do not trust an arbitrary first entry.
  const peer = (request.headers.get("x-forwarded-for") ?? "").split(",").at(-1)?.trim() ?? "";
  return { url, userData: { fbp: cookie("_fbp"), fbc: cookie("_fbc"), clientIpAddress: isIP(peer) ? peer : undefined, clientUserAgent: request.headers.get("user-agent")?.slice(0, 500) } };
}
