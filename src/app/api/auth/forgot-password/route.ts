import { NextResponse } from "next/server";

import { getPublicRequestUrl } from "@/lib/auth/request-url";
import { issuePasswordReset, isAuthTestMode } from "@/lib/auth/store";

export async function POST(request: Request) {
  const formData = await request.formData();
  const identifier = String(formData.get("identifier") ?? "").trim();

  if (!identifier) {
    return NextResponse.redirect(getPublicRequestUrl(request, `/forgot-password?error=${encodeURIComponent("Phone number or email is required.")}`));
  }

  const result = await issuePasswordReset(identifier);
  if (!result) {
    return NextResponse.redirect(getPublicRequestUrl(request, `/forgot-password?error=${encodeURIComponent("No internal user matches that phone or email.")}`));
  }

  const nextUrl = getPublicRequestUrl(request, "/forgot-password");
  nextUrl.searchParams.set("message", `Password reset token created for ${result.user.displayName}.`);
  if (isAuthTestMode()) {
    nextUrl.searchParams.set("resetToken", result.rawToken);
  }

  return NextResponse.redirect(nextUrl);
}
