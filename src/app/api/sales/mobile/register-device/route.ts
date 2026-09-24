import { NextResponse } from "next/server";
import { requireSalesMobileSession } from "@/lib/api/require-sales-mobile-session";
import { registerSalesMobileDevice } from "@/lib/gigxomi/sales-mobile-store";

export async function POST(request: Request) {
  const auth = await requireSalesMobileSession();
  if (!auth.ok) return auth.response;
  try {
    const device = await registerSalesMobileDevice(auth.actor, await request.json());
    return NextResponse.json({ ok: true, device });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to register device." }, { status: 400 });
  }
}
