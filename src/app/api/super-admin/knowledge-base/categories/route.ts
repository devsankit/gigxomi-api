import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { listKnowledgeBaseCategories, saveKnowledgeBaseCategory } from "@/lib/gigxomi/knowledge-base-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  return NextResponse.json({ ok: true, categories: await listKnowledgeBaseCategories() });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const body = await request.json();
    const category = await saveKnowledgeBaseCategory(body ?? {});
    return NextResponse.json({ ok: true, category });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save category." }, { status: 400 });
  }
}
