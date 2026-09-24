import { NextResponse } from "next/server";
import { appendMarketingDebugEvent } from "@/lib/gigxomi/public-growth-store";
import { hasPlayableVideo } from "@/lib/gigxomi/media";
import { matchServices } from "@/lib/gigxomi/matching";
import { fetchWordPressServices } from "@/lib/gigxomi/wordpress";
import type { DiscoveryPreset, MediaTypeFilter, SortOption } from "@/lib/gigxomi/types";

type MatchRequestBody = {
  prompt?: string;
  budget?: number;
  urgency?: string;
  category?: string;
  mediaType?: MediaTypeFilter;
  discoveryPreset?: DiscoveryPreset;
  sort?: SortOption;
};

export async function POST(request: Request) {
  const body = (await request.json()) as MatchRequestBody;

  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const services = await fetchWordPressServices();
  const payload = matchServices(services.items, body.prompt, {
    budget: body.budget,
    urgency: body.urgency,
    category: body.category,
    mediaType: body.mediaType,
    discoveryPreset: body.discoveryPreset,
    sort: body.sort,
  });

  const validatedResults = await Promise.all(
    payload.results.map(async (service) => {
      if (!service.video_url) {
        return service;
      }

      return (await hasPlayableVideo(service.video_url)) ? service : null;
    }),
  );

  payload.results = validatedResults.filter((service) => service !== null);

  const normalizedPrompt = body.prompt.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 160);
  const telemetryPayload = {
    prompt: body.prompt.trim().slice(0, 500),
    normalizedPrompt,
    category: body.category?.trim() || null,
    budget: body.budget ?? null,
    urgency: body.urgency?.trim() || null,
    mediaType: body.mediaType ?? null,
    discoveryPreset: body.discoveryPreset ?? null,
    sort: body.sort ?? null,
    resultCount: payload.results.length,
  };

  await appendMarketingDebugEvent({
    event: "prompt_search_submitted",
    path: "/api/match",
    payload: telemetryPayload,
  }).catch((error) => {
    console.warn("Failed to record prompt matcher telemetry", error);
  });

  if (payload.results.length === 0) {
    await appendMarketingDebugEvent({
      event: "prompt_search_no_result",
      path: "/api/match",
      payload: telemetryPayload,
    }).catch((error) => {
      console.warn("Failed to record prompt matcher no-result telemetry", error);
    });
  }

  return NextResponse.json(payload);
}
