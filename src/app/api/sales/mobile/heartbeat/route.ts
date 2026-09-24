import { NextResponse } from "next/server";
import { requireSalesMobileSession } from "@/lib/api/require-sales-mobile-session";
import { heartbeatSalesMobileDevice } from "@/lib/gigxomi/sales-mobile-store";

export async function POST(request: Request) {
  const auth = await requireSalesMobileSession();
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const device = await heartbeatSalesMobileDevice(auth.actor, String(body.deviceId ?? ""), body);
    return NextResponse.json({ ok: true, device });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Heartbeat failed." }, { status: 400 });
  }
}
