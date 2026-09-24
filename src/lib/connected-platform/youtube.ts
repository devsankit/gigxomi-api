const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeVideoId(value: string) {
  const input = value.trim();
  if (YOUTUBE_ID_PATTERN.test(input)) return input;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  let candidate = "";
  if (hostname === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (hostname === "youtube.com" || hostname === "m.youtube.com") {
    candidate = url.searchParams.get("v") ?? "";
    if (!candidate && url.pathname.startsWith("/embed/")) candidate = url.pathname.split("/")[2] ?? "";
    if (!candidate && url.pathname.startsWith("/shorts/")) candidate = url.pathname.split("/")[2] ?? "";
  }

  return YOUTUBE_ID_PATTERN.test(candidate) ? candidate : null;
}
export function buildYouTubeEmbedUrl(videoId: string) {
  if (!YOUTUBE_ID_PATTERN.test(videoId)) throw new Error("Enter a valid YouTube video URL.");
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
}
