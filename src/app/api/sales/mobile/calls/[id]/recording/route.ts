import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { readSalesMobileRecording } from "@/lib/gigxomi/sales-mobile-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSessionRole(["SALES_AGENT", "SUPER_ADMIN"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const recording = await readSalesMobileRecording({ userId: auth.session.userId, role: auth.session.role as "SALES_AGENT" | "SUPER_ADMIN" }, id);
    const size = recording.bytes.byteLength;
    const contentType = recording.call.recordingMimeType ?? "application/octet-stream";
    const range = request.headers.get("range");
    const headers = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Type": contentType,
    };

    if (!range) {
      return new NextResponse(recording.bytes, { headers: { ...headers, "Content-Length": String(size) } });
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }

    const requestedStart = match[1] ? Number(match[1]) : 0;
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    const start = Math.max(0, requestedStart);
    const end = Math.min(size - 1, requestedEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }

    const chunk = recording.bytes.subarray(start, end + 1);
    return new NextResponse(chunk, {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Recording not found." }, { status: 404 });
  }
}
