import { after, NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";
import { getSalesMetaStatus, qualifySalesLeadForMeta } from "@/lib/meta/sales-qualification";
import { deliverMetaConversions } from "@/lib/meta/conversions-api";

async function accessibleLead(leadId: string) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!auth.ok) return { response: auth.response };
  const snapshot = await getSalesSnapshotForRole(auth.session);
  const lead = snapshot.visibleLeads.find((item) => item.id === leadId);
  if (!lead || !auth.session.userId) return { response: NextResponse.json({ ok: false, error: "You do not have access to this lead." }, { status: 403 }) };
  return { lead, userId: auth.session.userId };
}
export async function GET(request: Request) {
  const access = await accessibleLead(new URL(request.url).searchParams.get("leadId") ?? "");
  if (access.response) return access.response;
  try {
    return NextResponse.json({ ok: true, ...(await getSalesMetaStatus(access.lead!)) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ ok: false, error: "Meta reporting status is temporarily unavailable." }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json") || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (body?.confirmQualified !== true || typeof body.leadId !== "string") return NextResponse.json({ ok: false, error: "Confirm that this lead is qualified before sharing with Meta." }, { status: 400 });
  const access = await accessibleLead(body.leadId);
  if (access.response) return access.response;
  try {
    const result = await qualifySalesLeadForMeta(access.lead!, access.userId!);
    // Immediate delivery after the response, with the independent worker retaining retries.
    after(async () => { await deliverMetaConversions(result.eventId).catch(() => undefined); });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const safeErrors = ["This lead has no verified WhatsApp ad attribution.", "A recent WhatsApp ad click ID is required.", "Lead conversation changed. Refresh before qualifying."];
    return NextResponse.json({ ok: false, error: error instanceof Error && safeErrors.includes(error.message) ? error.message : "Could not qualify this lead. Please refresh and retry." }, { status: 409 });
  }
}
