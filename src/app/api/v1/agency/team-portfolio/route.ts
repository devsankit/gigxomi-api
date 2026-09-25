import { NextResponse } from "next/server";

import { verifyAgencyToken } from "@/lib/api/agency-api-token-service";
import { getAgencyTeamPortfolio, type VideoOrientation } from "@/lib/api/team-portfolio-service";
import { getSessionContext } from "@/lib/auth/session";
import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { verifyInternalAgencyAssertion } from "@/lib/api/internal-assertion";
import { checkTeamPortfolioRateLimit } from "@/lib/api/rate-limit";

const ALLOWED_ORIGINS = [
  "https://agency.gigxomi.com",
  "http://localhost:3020",
];

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  if (!isAllowed) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Agency-Id, X-Gigxomi-Internal-Assertion, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(request: Request) {
  const corsHeaders = getCorsHeaders(request);
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function extractBearerToken(authHeader?: string | null): string | null {
  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }
  const [scheme, ...rest] = authHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }
  return rest.join(" ").trim() || null;
}

export async function GET(request: Request) {
  const corsHeaders = getCorsHeaders(request);
  const authHeader = request.headers.get("authorization");
  const bearerToken = extractBearerToken(authHeader);
  const internalAssertion = request.headers.get("x-gigxomi-internal-assertion");
  const rateLimitKey = `ip:${request.headers.get("x-forwarded-for") || "unknown"}`;
  const rateLimit = checkTeamPortfolioRateLimit(rateLimitKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded", code: "RATE_LIMITED" },
      { status: 429, headers: { ...corsHeaders, "Retry-After": String(rateLimit.retryAfter), "Cache-Control": "no-store" } },
    );
  }

  let resolvedTenantId: string | null = null;

  // First-party Agency Sites uses a short-lived signed assertion. It is
  // server-to-server only and never trusts a browser supplied tenant id.
  if (internalAssertion) {
    const assertionResult = verifyInternalAgencyAssertion(internalAssertion);
    if (!assertionResult.ok) {
      return NextResponse.json(
        { success: false, error: assertionResult.error, code: "UNAUTHORIZED" },
        { status: 401, headers: { ...corsHeaders, "Cache-Control": "no-store" } },
      );
    }
    resolvedTenantId = assertionResult.assertion.tenantId;
  } else if (bearerToken) {
    // External websites use an agency-scoped read-only token.
    const tokenResult = await verifyAgencyToken(bearerToken, "team_portfolio:read", request.headers.get("origin"));
    if (!tokenResult.ok) {
      return NextResponse.json(
        {
          success: false,
          error: tokenResult.error || "Invalid or revoked API token",
          code: "UNAUTHORIZED",
        },
        { status: tokenResult.status || 401, headers: { ...corsHeaders, "Cache-Control": "no-store" } },
      );
    }
    resolvedTenantId = tokenResult.tenantId;
  } else {
    // 2. Fallback to active Agency Session (Admin / Manager)
    const session = await getSessionContext();
    const isAgencyOperator =
      session.role === "ADMIN" ||
      session.role === "MANAGER" ||
      session.role === "SUPER_ADMIN" ||
      session.packageAudience === "AGENCY" ||
      session.workspaceMode === "AGENCY";

    if (session.userId && isAgencyOperator) {
      resolvedTenantId = resolveSessionTenantId(session) || session.tenantId || null;
    }
  }

  if (!resolvedTenantId) {
    return NextResponse.json(
      {
        success: false,
        error: "Authentication required. Provide a valid Bearer token or active agency session.",
        code: "UNAUTHORIZED",
      },
      { status: 401, headers: { ...corsHeaders, "Cache-Control": "no-store" } },
    );
  }

  // 3. Prevent Cross-Agency Isolation Breaches
  const requestedAgencyId = request.headers.get("x-agency-id")?.trim();
  if (requestedAgencyId && requestedAgencyId !== resolvedTenantId) {
    return NextResponse.json(
      {
        success: false,
        error: "Forbidden. Token is not authorized for the requested agency.",
        code: "FORBIDDEN",
      },
      { status: 403, headers: { ...corsHeaders, "Cache-Control": "no-store" } },
    );
  }

  // 4. Parse Query Parameters
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status")?.toLowerCase() || "active";
  if (status !== "active") {
    return NextResponse.json(
      { success: false, error: "Only active approved team portfolio is available", code: "INVALID_STATUS" },
      { status: 400, headers: { ...corsHeaders, "Cache-Control": "no-store" } },
    );
  }
  const category = searchParams.get("category")?.trim() || undefined;
  const orientationRaw = searchParams.get("orientation")?.toLowerCase()?.trim();
  const orientation: VideoOrientation | undefined =
    orientationRaw === "portrait" || orientationRaw === "landscape" || orientationRaw === "square"
      ? orientationRaw
      : undefined;

  const memberId = searchParams.get("memberId")?.trim() || undefined;
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, Math.round(limitParam))) : 20;
  const cursor = searchParams.get("cursor")?.trim() || undefined;

  try {
    const data = await getAgencyTeamPortfolio(resolvedTenantId, {
      status,
      category,
      orientation,
      memberId,
      limit,
      cursor,
    });

    return NextResponse.json(
      {
        success: true,
        data,
      },
      { status: 200, headers: { ...corsHeaders, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[TeamPortfolioApi] Error loading team portfolio:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to retrieve agency team portfolio.",
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: { ...corsHeaders, "Cache-Control": "no-store" } },
    );
  }
}
