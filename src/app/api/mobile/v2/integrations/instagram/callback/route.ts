import { NextResponse } from "next/server";

import { completeInstagramBusinessLogin } from "@/lib/connected-platform/instagram";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const metaError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (metaError) return NextResponse.redirect(`gigxomi://integrations?instagram=error&message=${encodeURIComponent(metaError)}`);
  try {
    await completeInstagramBusinessLogin({ code, state });
    return NextResponse.redirect("gigxomi://connected-onboarding?instagram=connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram connection failed.";
    return NextResponse.redirect(`gigxomi://integrations?instagram=error&message=${encodeURIComponent(message)}`);
  }
}
