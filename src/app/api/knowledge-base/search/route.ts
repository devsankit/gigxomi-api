import { NextResponse } from "next/server";

import { searchKnowledgeBase, type KnowledgeBaseRole } from "@/lib/gigxomi/knowledge-base-store";

function normalizeRole(value: string | null): KnowledgeBaseRole | null {
  const role = String(value ?? "").trim().toUpperCase();
  return role === "FREELANCER" || role === "AGENCY" || role === "PLATFORM" ? role : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const role = normalizeRole(searchParams.get("role"));
  const filters = searchParams.getAll("filters").flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  const results = await searchKnowledgeBase({ query, role, filters, limit: 12 });

  return NextResponse.json({
    ok: true,
    results: results.map((result) => ({
      score: result.score,
      matchedTerms: result.matchedTerms,
      article: result.article,
    })),
  });
}
