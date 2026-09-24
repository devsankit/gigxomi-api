import { NextResponse } from "next/server";
import { requireSalesMobileSession } from "@/lib/api/require-sales-mobile-session";
import { syncSalesMobileOfflineEvents } from "@/lib/gigxomi/sales-mobile-store";

export async function POST(request: Request) {
  const auth = await requireSalesMobileSession();
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const results = await syncSalesMobileOfflineEvents(auth.actor, Array.isArray(body.events) ? body.events : []);
    return NextResponse.json({ ok: results.every((result) => result.ok), results });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Offline sync failed." }, { status: 400 });
  }
}
