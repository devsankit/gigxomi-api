import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { CLIENT_META_EVENTS, websiteSource } from "@/lib/meta/conversion-contract";
import { enqueueMetaConversion, getMetaConversionConfig } from "@/lib/meta/conversions-api";
import { websiteConversionContext } from "@/lib/meta/website-conversion";

const buckets = new Map<string, { count: number; until: number }>();
export const dynamic = "force-dynamic";
export async function GET() {
  const config = getMetaConversionConfig();
  return NextResponse.json({ datasetId: config.websiteEnabled && config.accessToken ? config.datasetId : "" }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return NextResponse.json({ ok: false }, { status: 415 });
  const key = createHash("sha256").update((request.headers.get("x-forwarded-for") ?? "unknown").split(",").at(-1)!.trim()).digest("hex");
  const now = Date.now();
  for (const [id, value] of buckets) if (value.until <= now) buckets.delete(id);
  const bucket = buckets.get(key) ?? { count: 0, until: now + 60000 };
  if (++bucket.count > 30 || buckets.size >= 4096) return NextResponse.json({ ok: false }, { status: 429 });
  buckets.set(key, bucket);
  // Bound the stream too; Content-Length alone can be forged or absent.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ ok: false }, { status: 400 });
  let length = 0, raw = "";
  const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 4096) { await reader.cancel(); return NextResponse.json({ ok: false }, { status: 413 }); }
    raw += decoder.decode(chunk.value, { stream: true });
  }
  let body;
  try { body = JSON.parse(raw + decoder.decode()); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (!body || !CLIENT_META_EVENTS.includes(body.eventName) || typeof body.eventId !== "string" || !/^(pv|vc)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.eventId)
    || !body.eventId.startsWith(body.eventName === "PageView" ? "pv_" : "vc_")) return NextResponse.json({ ok: false }, { status: 400 });
  const context = websiteConversionContext(request, typeof body.eventSourceUrl === "string" ? body.eventSourceUrl : "");
  if (!context) return NextResponse.json({ ok: false }, { status: 403 });
  try {
    const result = await enqueueMetaConversion({ eventName: body.eventName, eventId: body.eventId, source: websiteSource(context.url), eventSourceUrl: context.url, userData: context.userData });
    return NextResponse.json({ ok: result.queued }, { status: result.queued ? 202 : 503 });
  } catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}
