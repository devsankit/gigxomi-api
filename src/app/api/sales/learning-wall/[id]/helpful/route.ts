import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { toggleSalesLearningPostReaction } from "@/lib/gigxomi/sales-operating-system-store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const { id } = await params;
  const result = await toggleSalesLearningPostReaction({ postId: id, userId: authorization.session.userId, type: "helpful" });
  return NextResponse.json({ ok: true, ...result });
}
