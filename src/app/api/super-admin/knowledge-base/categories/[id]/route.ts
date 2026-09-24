import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { deleteKnowledgeBaseCategory, saveKnowledgeBaseCategory } from "@/lib/gigxomi/knowledge-base-store";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const category = await saveKnowledgeBaseCategory({ ...(body ?? {}), id });
    return NextResponse.json({ ok: true, category });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to update category." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  await deleteKnowledgeBaseCategory(id);
  return NextResponse.json({ ok: true });
}
