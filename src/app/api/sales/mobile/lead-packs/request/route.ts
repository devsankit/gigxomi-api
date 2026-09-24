import { NextResponse } from "next/server";
import { requireSalesMobileSession } from "@/lib/api/require-sales-mobile-session";
import { requestSalesMobileLeadPack } from "@/lib/gigxomi/sales-mobile-store";

export async function POST(request: Request) {
  const auth = await requireSalesMobileSession();
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ ok: true, pack: await requestSalesMobileLeadPack(auth.actor, body.size) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to request leads." }, { status: 400 });
  }
}
