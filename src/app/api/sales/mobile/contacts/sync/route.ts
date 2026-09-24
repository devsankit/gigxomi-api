import { NextResponse } from "next/server";
import { requireSalesMobileSession } from "@/lib/api/require-sales-mobile-session";
import { syncSalesMobileContacts } from "@/lib/gigxomi/sales-mobile-store";

export async function POST(request: Request) {
  const auth = await requireSalesMobileSession();
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    return NextResponse.json({ ok: true, ...(await syncSalesMobileContacts(auth.actor, Array.isArray(body.contacts) ? body.contacts : [])) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Contact sync failed." }, { status: 400 });
  }
}
