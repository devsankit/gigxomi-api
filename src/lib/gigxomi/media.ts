export type VideoVariant = "portrait" | "landscape";

export type ResolvedMediaType =
  | "youtube"
  | "drive_file"
  | "drive_folder"
  | "instagram"
  | "vimeo"
  | "loom"
  | "direct"
  | "external"
  | "invalid";

export type ResolvedMedia = {
  type: ResolvedMediaType;
  url: string;
  embedUrl: string | null;
  directUrl: string | null;
  thumbnail: string | null;
  variant: VideoVariant;
  label: string;
  platform: string;
};

export type VideoPresentation = {
  directUrl: string | null;
  embedUrl: string | null;
  thumbnail: string | null;
  variant: VideoVariant;
  type?: ResolvedMediaType;
  label?: string;
  platform?: string;
};

const youtubeAvailabilityCache = new Map<string, Promise<boolean>>();

export function parseMediaUrls(raw?: string | null): string[] {
  if (!raw) return [];
  const matches = raw.match(/https?:\/\/[^\s"',]+/g);
  if (matches && matches.length > 0) {
    return matches.map((item) => item.trim());
  }
  const fallback = raw.trim();
  return fallback ? [fallback] : [];
}

export function isYouTubeOrInstagramUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be" ||
      host === "instagram.com" ||
      host === "m.instagram.com" ||
      host === "instagr.am"
    );
  } catch {
    return false;
  }
}

export function resolveMediaUrl(videoUrl?: string | null): ResolvedMedia {
  if (!videoUrl || typeof videoUrl !== "string") {
    return {
      type: "invalid",
      url: "",
      embedUrl: null,
      directUrl: null,
      thumbnail: null,
      variant: "landscape",
      label: "No link provided",
      platform: "None",
    };
  }

  const cleanUrl = videoUrl.trim();

  try {
    const parsed = new URL(cleanUrl);
    const host = parsed.hostname.replace(/^www\./, "");

    // YouTube
    if (host === "youtu.be") {
      const id = parsed.pathname.replace("/", "").split("/")[0]?.split("?")[0];
      if (id) {
        return {
          type: "youtube",
          url: cleanUrl,
          embedUrl: buildYouTubeEmbed(id),
          directUrl: null,
          thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
          variant: "landscape",
          label: "YouTube Video",
          platform: "YouTube",
        };
      }
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname.startsWith("/shorts/")) {
        const id = parsed.pathname.split("/")[2]?.split("?")[0];
        if (id) {
          return {
            type: "youtube",
            url: cleanUrl,
            embedUrl: buildYouTubeEmbed(id),
            directUrl: null,
            thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
            variant: "portrait",
            label: "YouTube Shorts",
            platform: "YouTube Shorts",
          };
        }
      }

      const id = parsed.searchParams.get("v");
      if (id) {
        return {
          type: "youtube",
          url: cleanUrl,
          embedUrl: buildYouTubeEmbed(id),
          directUrl: null,
          thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
          variant: "landscape",
          label: "YouTube Video",
          platform: "YouTube",
        };
      }
    }

    // Google Drive
    if (host === "drive.google.com") {
      // File
      const fileMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      const fileId = fileMatch ? fileMatch[1] : (parsed.pathname === "/open" ? parsed.searchParams.get("id") : null);
      if (fileId) {
        return {
          type: "drive_file",
          url: cleanUrl,
          embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
          directUrl: null,
          thumbnail: null,
          variant: "landscape",
          label: "Google Drive Video",
          platform: "Google Drive",
        };
      }

      // Folder
      const folderMatch = parsed.pathname.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/);
      if (folderMatch) {
        return {
          type: "drive_folder",
          url: cleanUrl,
          embedUrl: `https://drive.google.com/embeddedfolderview?id=${folderMatch[1]}#grid`,
          directUrl: null,
          thumbnail: null,
          variant: "landscape",
          label: "Google Drive Folder",
          platform: "Google Drive",
        };
      }
    }

    // Instagram
    if (host === "instagram.com" || host === "m.instagram.com" || host === "instagr.am") {
      const igMatch = parsed.pathname.match(/\/(reel|p)\/([a-zA-Z0-9_-]+)/);
      if (igMatch) {
        return {
          type: "instagram",
          url: cleanUrl,
          embedUrl: `https://www.instagram.com/${igMatch[1]}/${igMatch[2]}/embed/`,
          directUrl: null,
          thumbnail: null,
          variant: "portrait",
          label: "Instagram Reel",
          platform: "Instagram",
        };
      }
    }

    // Vimeo
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const vimeoMatch = parsed.pathname.match(/^\/(?:video\/)?(\d+)/);
      if (vimeoMatch) {
        return {
          type: "vimeo",
          url: cleanUrl,
          embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
          directUrl: null,
          thumbnail: null,
          variant: "landscape",
          label: "Vimeo Video",
          platform: "Vimeo",
        };
      }
    }

    // Loom
    if (host === "loom.com") {
      const loomMatch = parsed.pathname.match(/^\/(?:share|embed)\/([a-zA-Z0-9-]+)/);
      if (loomMatch) {
        return {
          type: "loom",
          url: cleanUrl,
          embedUrl: `https://www.loom.com/embed/${loomMatch[1]}`,
          directUrl: null,
          thumbnail: null,
          variant: "landscape",
          label: "Loom Recording",
          platform: "Loom",
        };
      }
    }

    // Direct Video file (MP4, WebM, MOV, etc.)
    if (/\.(mp4|webm|m4v|mov)(\?.*)?$/i.test(cleanUrl)) {
      return {
        type: "direct",
        url: cleanUrl,
        embedUrl: null,
        directUrl: cleanUrl,
        thumbnail: null,
        variant: "landscape",
        label: "Direct Video (MP4/WebM)",
        platform: "Direct Video",
      };
    }

    // External generic web link
    return {
      type: "external",
      url: cleanUrl,
      embedUrl: null,
      directUrl: null,
      thumbnail: null,
      variant: "landscape",
      label: host || "External Link",
      platform: host || "Web",
    };
  } catch {
    return {
      type: "invalid",
      url: cleanUrl,
      embedUrl: null,
      directUrl: null,
      thumbnail: null,
      variant: "landscape",
      label: "Invalid Link",
      platform: "Invalid",
    };
  }
}

export function getVideoPresentation(videoUrl: string): VideoPresentation {
  const resolved = resolveMediaUrl(videoUrl);
  return {
    embedUrl: resolved.embedUrl,
    directUrl: resolved.directUrl,
    thumbnail: resolved.thumbnail,
    variant: resolved.variant,
    type: resolved.type,
    label: resolved.label,
    platform: resolved.platform,
  };
}

export function getPlayerEmbedUrl(videoUrl: string) {
  const resolved = resolveMediaUrl(videoUrl);
  if (!resolved.embedUrl) return "";
  if (resolved.type === "youtube") {
    return `${resolved.embedUrl}&autoplay=1`;
  }
  return resolved.embedUrl;
}

export function getVideoEmbedUrl(videoUrl: string) {
  const resolved = resolveMediaUrl(videoUrl);
  return resolved.embedUrl;
}

export function getYouTubeThumbnail(videoUrl: string) {
  const videoId = getYouTubeVideoId(videoUrl);
  return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
}

export async function hasPlayableVideo(videoUrl: string) {
  if (!videoUrl) {
    return false;
  }

  const videoId = getYouTubeVideoId(videoUrl);
  if (!videoId) {
    return true;
  }

  const cached = youtubeAvailabilityCache.get(videoId);
  if (cached) {
    return cached;
  }

  const request = fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`, {
    next: { revalidate: 3600 },
    headers: {
      Accept: "application/json",
    },
  })
    .then((response) => response.ok)
    .catch(() => false);

  youtubeAvailabilityCache.set(videoId, request);
  return request;
}

export function isPortraitVideo(videoUrl: string) {
  if (!videoUrl) {
    return false;
  }

  return /shorts\//i.test(videoUrl);
}

function getYouTubeVideoId(videoUrl: string) {
  try {
    const url = new URL(videoUrl);
    const hostname = url.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      return url.pathname.replace("/", "") || null;
    }

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.split("/")[2] || null;
      }

      return url.searchParams.get("v");
    }
  } catch {
    return null;
  }

  return null;
}

function buildYouTubeEmbed(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1&iv_load_policy=3&fs=0&disablekb=1&color=white&modestbranding=1&controls=1`;
}
