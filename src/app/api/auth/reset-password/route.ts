import { NextResponse } from "next/server";

import { getPublicRequestUrl } from "@/lib/auth/request-url";
import { resetPasswordWithToken } from "@/lib/auth/store";

export async function POST(request: Request) {
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const confirmPassword = String(formData.get("confirmPassword") ?? "").trim();

  if (!token || !password || !confirmPassword) {
    return NextResponse.redirect(getPublicRequestUrl(request, `/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent("Token and both password fields are required.")}`));
  }

  if (password !== confirmPassword) {
    return NextResponse.redirect(getPublicRequestUrl(request, `/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent("Passwords do not match.")}`));
  }

  const result = await resetPasswordWithToken(token, password);
  if (!result.ok) {
    return NextResponse.redirect(getPublicRequestUrl(request, `/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(result.error)}`));
  }

  const destinationPath = result.user?.role === "MANAGER" ? "/manager-login" : "/login";
  return NextResponse.redirect(getPublicRequestUrl(request, `${destinationPath}?message=${encodeURIComponent("Password updated. You can sign in now.")}`));
}
