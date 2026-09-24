import { NextResponse } from "next/server";

import { clearImpersonationCookies } from "@/lib/auth/impersonation";
import { getPublicRequestUrl } from "@/lib/auth/request-url";
import { clearSessionCookie } from "@/lib/auth/session";

function createLogoutResponse(request: Request) {
  const response = NextResponse.redirect(getPublicRequestUrl(request, "/"), 303);
  clearSessionCookie(response);
  clearImpersonationCookies(response);
  return response;
}

export async function GET(request: Request) {
  return createLogoutResponse(request);
}

export async function POST(request: Request) {
  return createLogoutResponse(request);
}
