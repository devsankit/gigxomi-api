import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { createSalesMessage, getSalesSnapshotForRole, replySalesMessage } from "@/lib/gigxomi/sales-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const snapshot = await getSalesSnapshotForRole(authorization.session);
  const visibleAgentIds = new Set(snapshot.visibleAgents.map((agent) => agent.id));
  return NextResponse.json({
    ok: true,
    announcements: snapshot.announcements.filter((announcement) => announcement.isActive),
    messages: snapshot.messages.filter((thread) => !thread.agentId || visibleAgentIds.has(thread.agentId)),
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send a valid message." }, { status: 400 });

  if (body.action === "reply") {
    const thread = await replySalesMessage({
      threadId: String(body.threadId ?? ""),
      body: String(body.body ?? ""),
      author: authorization.session.displayName,
      close: body.close === true,
    });
    return NextResponse.json({ ok: true, thread });
  }

  const snapshot = await getSalesSnapshotForRole(authorization.session);
  const thread = await createSalesMessage({
    agentId: authorization.session.role === "SALES_AGENT" ? snapshot.currentAgent?.id ?? null : typeof body.agentId === "string" ? body.agentId : null,
    subject: String(body.subject ?? "Sales message"),
    body: String(body.body ?? ""),
    author: authorization.session.displayName,
  });
  return NextResponse.json({ ok: true, thread });
}
