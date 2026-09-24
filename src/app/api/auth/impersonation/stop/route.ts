import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  clearImpersonationCookies,
  IMPERSONATION_RETURN_PATH_COOKIE_NAME,
  SUPER_ADMIN_RETURN_COOKIE_NAME,
} from "@/lib/auth/impersonation";
import { getPublicRequestUrl } from "@/lib/auth/request-url";
import { applySessionCookie, clearSessionCookie } from "@/lib/auth/session";
import { SUPER_ADMIN_LOGIN_ROUTE } from "@/lib/auth/super-admin-config";
import { verifySessionToken } from "@/lib/auth/token";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const returnToken = cookieStore.get(SUPER_ADMIN_RETURN_COOKIE_NAME)?.value;
  const requestedReturnPath = cookieStore.get(IMPERSONATION_RETURN_PATH_COOKIE_NAME)?.value;
  const superAdminSession = await verifySessionToken(returnToken);

  if (!superAdminSession || superAdminSession.role !== "SUPER_ADMIN") {
    const response = NextResponse.redirect(getPublicRequestUrl(request, SUPER_ADMIN_LOGIN_ROUTE), 303);
    clearSessionCookie(response);
    clearImpersonationCookies(response);
    return response;
  }

  const returnPath = requestedReturnPath === "/super-admin/freelancers" ? requestedReturnPath : "/super-admin/agencies";
  const response = NextResponse.redirect(getPublicRequestUrl(request, returnPath), 303);
  await applySessionCookie(response, superAdminSession);
  clearImpersonationCookies(response);

  console.info("[auth] Super Admin returned from a managed workspace", {
    superAdminUserId: superAdminSession.userId,
    returnedAt: new Date().toISOString(),
  });

  return response;
}
