import { NextResponse } from "next/server";
import { requireSalesMobileSession } from "@/lib/api/require-sales-mobile-session";
import { saveSalesMobileRecording } from "@/lib/gigxomi/sales-mobile-store";

export async function POST(request: Request) {
  const auth = await requireSalesMobileSession();
  if (!auth.ok) return auth.response;
  try {
    const form = await request.formData();
    const callId = String(form.get("callSessionId") ?? form.get("callId") ?? "");
    const recordingDurationMs = Number(form.get("recordingDurationMs") ?? 0);
    const file = form.get("recording");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Attach the recording file." }, { status: 400 });
    return NextResponse.json({ ok: true, call: await saveSalesMobileRecording(auth.actor, callId, file, recordingDurationMs) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Recording upload failed." }, { status: 400 });
  }
}
