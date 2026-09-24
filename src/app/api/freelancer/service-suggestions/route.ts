import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listPromptSearchDemandSuggestions } from "@/lib/gigxomi/public-growth-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const suggestions = await listPromptSearchDemandSuggestions(18);

  return NextResponse.json({
    ok: true,
    suggestions,
  });
}
