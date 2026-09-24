import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  getMarketingEventBlueprints,
  getMarketingIntegrationSettings,
  listMarketingDebugEvents,
  saveMarketingIntegrationSettings,
} from "@/lib/gigxomi/public-growth-store";
import type { MarketingIntegrationSettings } from "@/lib/gigxomi/public-growth-types";

type MarketingRequestBody = Partial<MarketingIntegrationSettings>;

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const [settings, recentEvents] = await Promise.all([getMarketingIntegrationSettings(), listMarketingDebugEvents(18)]);
  return NextResponse.json({
    ok: true,
    settings,
    blueprints: getMarketingEventBlueprints(),
    recentEvents,
  });
}

export async function POST(request: Request) {
  const auth = await requireSessionRole(["SUPER_ADMIN"]);
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as MarketingRequestBody | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Marketing settings payload is required." }, { status: 400 });
  }

  const settings = await saveMarketingIntegrationSettings({
    ga4MeasurementId: readTrimmedString(body.ga4MeasurementId),
    gtmContainerId: readTrimmedString(body.gtmContainerId),
    searchConsoleSiteUrl: readTrimmedString(body.searchConsoleSiteUrl),
    searchConsoleVerification: readTrimmedString(body.searchConsoleVerification),
    metaPixelId: readTrimmedString(body.metaPixelId),
    pixelEndpoint: readTrimmedString(body.pixelEndpoint),
  });

  const recentEvents = await listMarketingDebugEvents(18);
  return NextResponse.json({
    ok: true,
    settings,
    blueprints: getMarketingEventBlueprints(),
    recentEvents,
  });
}
