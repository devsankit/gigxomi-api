import { getWhatsAppConnectionStateFromFile } from "./dummy-platform-file-store";

const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || "";
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL?.trim() || "qwen/qwen3.8-27b";

export interface WhatsAppMediaAttachment {
  type: "image" | "document" | "audio" | "video" | "sticker";
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  caption?: string;
}

/**
 * Downloads media buffer securely from Meta Graph API using the tenant's WhatsApp access token.
 */
export async function downloadWhatsAppMediaBuffer(
  tenantId: string,
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const normalizedId = mediaId.trim();
  if (!normalizedId) return null;

  try {
    const connection = await getWhatsAppConnectionStateFromFile(tenantId);
    const accessToken = connection?.accessToken?.trim();
    const graphVersion = connection?.graphApiVersion || "v21.0";

    if (!accessToken) {
      console.warn("[MEDIA_READER] Missing access token for tenant:", tenantId);
      return null;
    }

    // Step 1: Query Meta Graph API for media download URL
    const metaUrl = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(normalizedId)}`;
    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!metaRes.ok) {
      console.warn(`[MEDIA_READER] Meta Graph API returned ${metaRes.status} for media ${normalizedId}`);
      return null;
    }

    const metaData = (await metaRes.json().catch(() => null)) as { url?: string; mime_type?: string } | null;
    const downloadUrl = metaData?.url?.trim();
    const mimeType = metaData?.mime_type || "application/octet-stream";

    if (!downloadUrl) {
      console.warn(`[MEDIA_READER] No download URL returned for media ${normalizedId}`);
      return null;
    }

    // Step 2: Download the raw binary stream
    const mediaRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!mediaRes.ok) {
      console.warn(`[MEDIA_READER] Failed downloading media file: HTTP ${mediaRes.status}`);
      return null;
    }

    const arrayBuffer = await mediaRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: mediaRes.headers.get("content-type") || mimeType,
    };
  } catch (err) {
    console.error("[MEDIA_READER] Error fetching media buffer:", err);
    return null;
  }
}

/**
 * Uses Groq Vision (llama-3.2-11b-vision-preview) to analyze an image sent by a lead.
 */
export async function analyzeWhatsAppImageWithVision(
  buffer: Buffer,
  mimeType: string,
  caption?: string,
): Promise<string> {
  try {
    const base64Data = buffer.toString("base64");
    const dataUrl = `data:${mimeType || "image/jpeg"};base64,${base64Data}`;

    const prompt = [
      "Analyze this image from a user contacting Gigxomi, a video editing workflow software company.",
      caption ? `The user provided this caption: "${caption}".` : "",
      "First output exactly SUPPORT_HANDOFF: YES or SUPPORT_HANDOFF: NO. Use YES only when the image visibly contains an error, failed operation, blocked login/connection, or product problem that needs troubleshooting. Use NO for portfolios, normal editing timelines, samples, invoices, and ordinary screenshots. Do not infer an error that is not visible. Then give one short factual description of the image.",
    ]
      .filter(Boolean)
      .join(" ");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      console.warn(`[MEDIA_READER] Groq Vision HTTP error ${response.status}`);
      return caption ? `Image with caption: "${caption}"` : "User shared an image attachment.";
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim();
    if (description) {
      return description;
    }

    return caption ? `Image with caption: "${caption}"` : "User shared an image.";
  } catch (err) {
    console.error("[MEDIA_READER] Image vision analysis failed:", err);
    return caption ? `Image with caption: "${caption}"` : "User shared an image.";
  }
}

/**
 * Extracts readable text summary from PDF or text documents.
 */
export function extractWhatsAppDocumentSnippet(
  buffer: Buffer,
  fileName?: string,
  caption?: string,
): string {
  try {
    const content = buffer.toString("utf8", 0, Math.min(buffer.length, 32000));
    
    // Look for PDF text objects ((text) Tj or [(text)] TJ)
    const pdfTextMatches = content.match(/\(([^\(\)\\]{2,100})\)\s*Tj/g) || [];
    if (pdfTextMatches.length > 0) {
      const extractedWords = pdfTextMatches
        .map((m) => m.replace(/^\(/, "").replace(/\)\s*Tj$/, "").trim())
        .filter((w) => w.length > 1 && !/^[\d\.\s]+$/.test(w))
        .slice(0, 40)
        .join(" ");

      if (extractedWords.length > 10) {
        return `PDF Document "${fileName || "document.pdf"}": contains content regarding "${extractedWords.slice(0, 160)}..."`;
      }
    }

    // Plain text / markdown fallback
    const cleanPrintable = content
      .replace(/[^\x20-\x7E\n\r\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleanPrintable.length > 30) {
      return `Document "${fileName || "file"}": "${cleanPrintable.slice(0, 200)}..."`;
    }

    return `Document attachment: ${fileName || "Document"} ${caption ? `(${caption})` : ""}`.trim();
  } catch {
    return `Document attachment: ${fileName || "Document"}`;
  }
}

/**
 * Main handler to inspect incoming WhatsApp attachments and generate conversational AI context.
 */
export async function summarizeIncomingWhatsAppMedia(input: {
  tenantId?: string;
  attachments?: WhatsAppMediaAttachment[];
}): Promise<string> {
  const tenantId = input.tenantId || "tenant-gigxomi";
  const attachments = input.attachments || [];
  if (attachments.length === 0) return "";

  const summaries: string[] = [];

  for (const attachment of attachments) {
    const mediaId = attachment.mediaId?.trim();
    if (!mediaId) {
      if (attachment.caption) summaries.push(attachment.caption);
      continue;
    }

    // Fetch binary from Meta
    const downloaded = await downloadWhatsAppMediaBuffer(tenantId, mediaId);
    if (!downloaded) {
      summaries.push(attachment.caption ? `Sent attachment: ${attachment.caption}` : `Sent ${attachment.type} attachment`);
      continue;
    }

    if (attachment.type === "image") {
      const visionSummary = await analyzeWhatsAppImageWithVision(
        downloaded.buffer,
        downloaded.mimeType || attachment.mimeType || "image/jpeg",
        attachment.caption,
      );
      summaries.push(`[Sent Image: ${visionSummary}]`);
    } else if (attachment.type === "document") {
      const docSnippet = extractWhatsAppDocumentSnippet(
        downloaded.buffer,
        attachment.fileName,
        attachment.caption,
      );
      summaries.push(`[Sent Document: ${docSnippet}]`);
    } else if (attachment.type === "audio") {
      summaries.push(`[Sent Voice Note / Audio Message: ${attachment.caption || "Audio recording"}]`);
    } else {
      summaries.push(`[Sent ${attachment.type} file: ${attachment.fileName || attachment.caption || "media"}]`);
    }
  }

  return summaries.join("\n");
}
