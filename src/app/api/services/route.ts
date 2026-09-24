import { NextResponse } from "next/server";

import { listPublicServicesFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "0");
  const services = await listPublicServicesFromFile();

  return NextResponse.json({
    ok: true,
    count: limit > 0 ? services.slice(0, limit).length : services.length,
    items: limit > 0 ? services.slice(0, limit) : services,
  });
}
