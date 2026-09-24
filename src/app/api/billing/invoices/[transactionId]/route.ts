import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getBillingInvoice } from "@/lib/billing/invoice-service";

export async function GET(_: Request, context: { params: Promise<{ transactionId: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { transactionId } = await context.params;
  const invoice = await getBillingInvoice(transactionId).catch((error) => ({
    error: error instanceof Error ? error.message : "Unable to generate invoice.",
  }));

  if ("error" in invoice) {
    return NextResponse.json({ ok: false, error: invoice.error }, { status: 404 });
  }

  const canDownload =
    authorization.session.role === "SUPER_ADMIN" ||
    authorization.session.userId === invoice.transaction.userId ||
    authorization.session.tenantId === invoice.transaction.user.tenantId;

  if (!canDownload) {
    return NextResponse.json({ ok: false, error: "You do not have access to this invoice." }, { status: 403 });
  }

  return new Response(new Uint8Array(invoice.pdf), {
    headers: {
      "Content-Type": invoice.mimeType,
      "Content-Disposition": `attachment; filename="${invoice.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
