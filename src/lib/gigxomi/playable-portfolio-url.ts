export type PlayablePortfolioPlatform = "YOUTUBE" | "INSTAGRAM_REEL" | "GOOGLE_DRIVE" | "DIRECT_VIDEO" | "GIGXOMI_UPLOAD" | "WEBSITE";

export type PlayablePortfolioUrlResult =
  | { ok: true; normalizedUrl: string; platform: PlayablePortfolioPlatform; embedUrl: string }
  | { ok: false; error: string };

const PLAYABLE_ERROR = "Use a valid HTTPS website portfolio or a supported video: YouTube, Instagram Reel, public Google Drive video, direct MP4/WebM, or Gigxomi upload.";

export function parsePlayablePortfolioUrl(value: unknown): PlayablePortfolioUrlResult {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) return { ok: false, error: PLAYABLE_ERROR };

  if (/^\/uploads\/freelancer-portfolios\/[a-z0-9._-]+$/i.test(input)) {
    return { ok: true, normalizedUrl: input, platform: "GIGXOMI_UPLOAD", embedUrl: input };
  }

  try {
    const url = new URL(input);
    if (url.protocol !== "https:") return { ok: false, error: PLAYABLE_ERROR };
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? { ok: true, normalizedUrl: url.toString(), platform: "YOUTUBE", embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1` } : { ok: false, error: PLAYABLE_ERROR };
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = url.pathname.startsWith("/shorts/") ? url.pathname.split("/")[2] : url.searchParams.get("v");
      return id ? { ok: true, normalizedUrl: url.toString(), platform: "YOUTUBE", embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1` } : { ok: false, error: PLAYABLE_ERROR };
    }
    if (host === "instagram.com" || host === "m.instagram.com") {
      const [kind, id] = url.pathname.split("/").filter(Boolean);
      return kind === "reel" && id
        ? { ok: true, normalizedUrl: url.toString(), platform: "INSTAGRAM_REEL", embedUrl: `https://www.instagram.com/reel/${id}/embed/` }
        : { ok: false, error: PLAYABLE_ERROR };
    }
    if (host === "drive.google.com") {
      const id = url.pathname.match(/\/file\/d\/([^/]+)/i)?.[1] || url.searchParams.get("id");
      return id ? { ok: true, normalizedUrl: url.toString(), platform: "GOOGLE_DRIVE", embedUrl: `https://drive.google.com/file/d/${id}/preview` } : { ok: false, error: PLAYABLE_ERROR };
    }
    if (/\.(mp4|webm)(?:$|\?)/i.test(url.toString())) {
      return { ok: true, normalizedUrl: url.toString(), platform: "DIRECT_VIDEO", embedUrl: url.toString() };
    }
    return { ok: true, normalizedUrl: url.toString(), platform: "WEBSITE", embedUrl: "" };
  } catch {
    return { ok: false, error: PLAYABLE_ERROR };
  }

  return { ok: false, error: PLAYABLE_ERROR };
}

export function isPlayablePortfolioUrl(value: unknown) {
  const result = parsePlayablePortfolioUrl(value);
  return result.ok && result.platform !== "WEBSITE";
}

export function isAcceptedPortfolioUrl(value: unknown) {
  return parsePlayablePortfolioUrl(value).ok;
}

export const PLAYABLE_PORTFOLIO_URL_ERROR = PLAYABLE_ERROR;
