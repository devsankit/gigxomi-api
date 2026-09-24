import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json();

  const rawTitle = String(body?.title ?? "").trim();
  const rawSummary = String(body?.summary ?? "").trim();
  const rawDescription = String(body?.description ?? "").trim();
  const rawNiche = String(body?.niche ?? "").trim();
  const rawAudience = String(body?.targetAudience ?? "").trim();
  const rawTags = String(body?.tags ?? "")
    .split(",")
    .map((item: string) => item.trim().toLowerCase())
    .filter(Boolean);
  const category = body?.category === "Graphic Design" ? "Graphic Design Service" : "Video Editing Service";
  const nichePrefix = rawNiche ? `${rawNiche} ` : "";
  const audiencePhrase = rawAudience || "creators and brands";
  const safeTitle = rawTitle || `${nichePrefix}${category}`.trim();
  const defaultKeywords = body?.category === "Graphic Design"
    ? ["graphic design service", "poster design", "thumbnail design"]
    : ["video editing service", "reel editing", "youtube editing"];
  const keywords = Array.from(new Set([...rawTags, ...defaultKeywords, rawNiche.toLowerCase()].filter(Boolean))).slice(0, 8);
  const seoTitle = `${safeTitle} | ${category}`.slice(0, 70);
  const seoDescription =
    (rawSummary || rawDescription || `Professional ${nichePrefix.toLowerCase()}${category.toLowerCase()} for ${audiencePhrase} with clear pricing and fast delivery on Gigxomi.`).slice(
      0,
      158,
    );

  return NextResponse.json({
    ok: true,
    seo: {
      title: seoTitle,
      description: seoDescription,
      keywords,
      summary: `SEO guidance generated for ${safeTitle || "service draft"} with schema-ready metadata hints.`,
      schema: {
        serviceType: body?.category === "Graphic Design" ? "DesignService" : "VideoEditingService",
        areaServed: "Worldwide",
        offerCategory: body?.category === "Graphic Design" ? "CreativeDesign" : "PostProduction",
      },
    },
  });
}
