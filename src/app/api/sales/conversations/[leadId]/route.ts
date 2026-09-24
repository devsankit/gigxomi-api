import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { ensureSalesLeadConversation } from "@/lib/gigxomi/sales-conversation-store";
import { getSalesOperatingSnapshot } from "@/lib/gigxomi/sales-operating-system-store";
import { getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";

export async function GET(_request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const { leadId } = await params;
  const [sales, operating] = await Promise.all([getSalesSnapshotForRole(authorization.session), getSalesOperatingSnapshot(authorization.session)]);
  const lead = sales.visibleLeads.find((item) => item.id === leadId);
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });
  return NextResponse.json({ ok: true, lead, timeline: operating.timeline.filter((entry) => entry.leadId === leadId) });
}

export async function POST(_request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const { leadId } = await params;
  const sales = await getSalesSnapshotForRole(authorization.session);
  const lead = sales.visibleLeads.find((item) => item.id === leadId);
  if (!lead) return NextResponse.json({ ok: false, error: "You do not have access to this lead." }, { status: 403 });
  if (!lead.customerPhone) return NextResponse.json({ ok: false, error: "This lead does not have a WhatsApp number." }, { status: 400 });

  try {
    const conversation = await ensureSalesLeadConversation({
      leadId: lead.id,
      conversationId: lead.conversationId,
      customerName: lead.customerName,
      customerPhone: lead.customerPhone,
      tenantId: resolveWhatsAppSetupTenantId(authorization.session),
    });
    return NextResponse.json({ ok: true, conversationId: conversation.id });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to open WhatsApp chat." }, { status: 400 });
  }
}
