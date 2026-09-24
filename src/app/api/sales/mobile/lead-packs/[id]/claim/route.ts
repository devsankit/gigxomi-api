import { NextResponse } from "next/server";
import { requireSalesMobileSession } from "@/lib/api/require-sales-mobile-session";
import { claimSalesMobileLeadPack } from "@/lib/gigxomi/sales-mobile-store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSalesMobileSession();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    return NextResponse.json({ ok: true, leads: await claimSalesMobileLeadPack(auth.actor, id) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to claim leads." }, { status: 400 });
  }
}
