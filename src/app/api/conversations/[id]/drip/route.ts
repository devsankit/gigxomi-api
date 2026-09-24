import { NextResponse } from "next/server";
import { getConversationDripStatus, setConversationDripPaused } from "@/lib/gigxomi/whatsapp-lead-drip-engine";
import { requireSessionRole } from "@/lib/api/require-session-role";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const { id } = await context.params;
  const status = await getConversationDripStatus(id);

  return NextResponse.json({
    ok: true,
    drip: status,
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const paused = Boolean(body?.paused);

  const updated = await setConversationDripPaused(id, paused);

  return NextResponse.json({
    ok: true,
    drip: updated,
  });
}
