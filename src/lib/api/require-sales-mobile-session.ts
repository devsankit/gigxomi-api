import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";

export async function requireSalesMobileSession() {
  const authorization = await requireSessionRole(["SALES_AGENT", "SUPER_ADMIN"]);
  if (!authorization.ok) return authorization;
  if (authorization.session.role !== "SALES_AGENT") {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "A sales-agent account is required in the mobile CRM." }, { status: 403 }) };
  }
  return { ok: true as const, session: authorization.session, actor: { userId: authorization.session.userId, role: "SALES_AGENT" as const } };
}
