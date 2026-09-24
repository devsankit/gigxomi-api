import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  listAllKnowledgeBaseArticles,
  listKnowledgeBaseCategories,
  listKnowledgeBaseMedia,
  saveKnowledgeBaseArticle,
} from "@/lib/gigxomi/knowledge-base-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const [articles, categories, media] = await Promise.all([
    listAllKnowledgeBaseArticles(),
    listKnowledgeBaseCategories(),
    listKnowledgeBaseMedia(),
  ]);

  return NextResponse.json({ ok: true, articles, categories, media });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const body = await request.json();
    const article = await saveKnowledgeBaseArticle(body ?? {});
    return NextResponse.json({ ok: true, article });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save article." }, { status: 400 });
  }
}
