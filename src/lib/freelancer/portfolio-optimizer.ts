export type PortfolioUrlAnalysis = {
  platform: "youtube" | "drive" | "instagram" | "vimeo" | "loom" | "direct_video" | "unknown";
  isPlayable: boolean;
  isDriveFolder: boolean;
  embedUrl: string | null;
  score: number; // 0 to 100
  rating: "needs_work" | "good" | "excellent";
  checklist: Array<{
    id: string;
    label: string;
    passed: boolean;
    level: "success" | "warning" | "error";
    hint?: string;
  }>;
  suggestions: string[];
};

export function analyzePortfolioUrl(urlInput: string, title?: string): PortfolioUrlAnalysis {
  const trimmed = urlInput?.trim() || "";
  const checklist: PortfolioUrlAnalysis["checklist"] = [];
  const suggestions: string[] = [];

  if (!trimmed) {
    return {
      platform: "unknown",
      isPlayable: false,
      isDriveFolder: false,
      embedUrl: null,
      score: 0,
      rating: "needs_work",
      checklist: [
        { id: "url", label: "Provide a playable video or showcase link", passed: false, level: "error", hint: "Paste a YouTube, Google Drive, or Instagram reel link." },
      ],
      suggestions: ["Add a playable video link to show clients your editing style."],
    };
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return {
      platform: "unknown",
      isPlayable: false,
      isDriveFolder: false,
      embedUrl: null,
      score: 15,
      rating: "needs_work",
      checklist: [
        { id: "valid_url", label: "Valid URL format", passed: false, level: "error", hint: "Make sure link starts with https://" },
      ],
      suggestions: ["Check the URL syntax and paste a complete link."],
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = parsed.pathname;

  let platform: PortfolioUrlAnalysis["platform"] = "unknown";
  let isPlayable = false;
  let isDriveFolder = false;
  let embedUrl: string | null = null;
  let score = 25; // Base score for valid URL

  // 1. YouTube
  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
    platform = "youtube";
    let videoId = "";
    if (hostname.includes("youtu.be")) {
      videoId = pathname.replace(/^\//, "").split("/")[0] || "";
    } else if (pathname.includes("/shorts/")) {
      videoId = pathname.split("/shorts/")[1]?.split("/")[0] || "";
    } else {
      videoId = parsed.searchParams.get("v") || "";
    }

    if (videoId) {
      isPlayable = true;
      embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`;
      score += 45;
      checklist.push({
        id: "yt_embed",
        label: "Direct YouTube video detected",
        passed: true,
        level: "success",
        hint: "One-click playback in buyer previews.",
      });
    } else {
      checklist.push({
        id: "yt_invalid",
        label: "YouTube link missing video ID",
        passed: false,
        level: "warning",
        hint: "Paste the full video or Shorts link.",
      });
      suggestions.push("Paste a specific YouTube video link instead of a channel URL.");
    }
  }

  // 2. Google Drive
  else if (hostname.includes("drive.google.com")) {
    platform = "drive";
    if (pathname.includes("/folders/") || pathname.includes("/drive/folders")) {
      isDriveFolder = true;
      isPlayable = false;
      score += 15;
      checklist.push({
        id: "drive_folder",
        label: "Google Drive folder detected",
        passed: false,
        level: "warning",
        hint: "Clients often cannot preview full folders without sign-in. Use a single video file link instead.",
      });
      suggestions.push("⚠️ Replace folder link with a single video file link (e.g. drive.google.com/file/d/...) so clients can play it with 1 click.");
    } else {
      const match = pathname.match(/\/file\/d\/([^/]+)/i);
      const fileId = match?.[1] || parsed.searchParams.get("id") || "";
      if (fileId) {
        isPlayable = true;
        embedUrl = `https://drive.google.com/file/d/${fileId}/preview`;
        score += 40;
        checklist.push({
          id: "drive_file",
          label: "Single Drive video file link",
          passed: true,
          level: "success",
          hint: "Ensure file sharing is set to 'Anyone with the link can view'.",
        });
      } else {
        score += 10;
        checklist.push({
          id: "drive_generic",
          label: "Drive link format",
          passed: false,
          level: "warning",
          hint: "Open your video file, click Share -> Copy Link.",
        });
      }
    }
  }

  // 3. Instagram
  else if (hostname.includes("instagram.com")) {
    platform = "instagram";
    const segments = pathname.split("/").filter(Boolean);
    const type = segments[0];
    const id = segments[1];
    if ((type === "reel" || type === "p") && id) {
      isPlayable = true;
      embedUrl = `https://www.instagram.com/${type}/${id}/embed/`;
      score += 40;
      checklist.push({
        id: "ig_reel",
        label: "Direct Instagram Reel link",
        passed: true,
        level: "success",
        hint: "Verified public Instagram reel embedded.",
      });
    } else {
      score += 15;
      checklist.push({
        id: "ig_profile",
        label: "Instagram profile link",
        passed: false,
        level: "warning",
        hint: "Paste a specific public Reel link instead of your profile page.",
      });
      suggestions.push("Paste a direct Reel URL (e.g. instagram.com/reel/...) for inline video playback.");
    }
  }

  // 4. Vimeo
  else if (hostname.includes("vimeo.com")) {
    platform = "vimeo";
    const vimeoId = pathname.replace(/^\//, "").split("/")[0];
    if (vimeoId && /^\d+$/.test(vimeoId)) {
      isPlayable = true;
      embedUrl = `https://player.vimeo.com/video/${vimeoId}?autoplay=1`;
      score += 45;
      checklist.push({
        id: "vimeo_embed",
        label: "Direct Vimeo showcase video",
        passed: true,
        level: "success",
      });
    }
  }

  // 5. Loom
  else if (hostname.includes("loom.com")) {
    platform = "loom";
    const loomId = pathname.split("/share/")[1]?.split("?")[0] || "";
    if (loomId) {
      isPlayable = true;
      embedUrl = `https://www.loom.com/embed/${loomId}`;
      score += 40;
      checklist.push({
        id: "loom_embed",
        label: "Loom video recording",
        passed: true,
        level: "success",
      });
    }
  }

  // 6. Direct MP4 / WebM
  else if (pathname.endsWith(".mp4") || pathname.endsWith(".webm")) {
    platform = "direct_video";
    isPlayable = true;
    embedUrl = trimmed;
    score += 45;
    checklist.push({
      id: "direct_mp4",
      label: "Direct MP4 video file",
      passed: true,
      level: "success",
      hint: "Instant native video playback.",
    });
  }

  // Non-video URL
  if (!isPlayable && !isDriveFolder) {
    checklist.push({
      id: "unsupported_embed",
      label: "External link (non-playable)",
      passed: false,
      level: "warning",
      hint: "Clients prefer playable video embeds. YouTube or Drive preview links convert 3x better.",
    });
    suggestions.push("Upload to YouTube (Unlisted) or Google Drive for instant inline playback.");
  }

  // HTTPS check
  if (parsed.protocol === "https:") {
    score += 10;
    checklist.push({
      id: "https",
      label: "Secure HTTPS link",
      passed: true,
      level: "success",
    });
  }

  // Title / description check
  if (title && title.trim().length >= 10) {
    score += 15;
    checklist.push({
      id: "title_provided",
      label: "Descriptive sample title",
      passed: true,
      level: "success",
    });
  } else {
    suggestions.push("Add a descriptive service title to reach 100% submission score.");
  }

  // Cap score
  score = Math.min(100, Math.max(10, score));

  const rating: PortfolioUrlAnalysis["rating"] =
    score >= 80 ? "excellent" : score >= 50 ? "good" : "needs_work";

  return {
    platform,
    isPlayable,
    isDriveFolder,
    embedUrl,
    score,
    rating,
    checklist,
    suggestions,
  };
}
