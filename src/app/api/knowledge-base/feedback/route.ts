import { NextResponse } from "next/server";

import { recordKnowledgeBaseFeedback } from "@/lib/gigxomi/knowledge-base-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    articleId?: unknown;
    comment?: unknown;
    helpful?: unknown;
  } | null;

  const articleId = typeof body?.articleId === "string" ? body.articleId.trim() : "";
  if (!articleId || typeof body?.helpful !== "boolean") {
    return NextResponse.json({ ok: false, error: "Article and feedback value are required." }, { status: 400 });
  }

  await recordKnowledgeBaseFeedback({
    articleId,
    helpful: body.helpful,
    comment: typeof body.comment === "string" ? body.comment : "",
  });

  return NextResponse.json({ ok: true });
}
