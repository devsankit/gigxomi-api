import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { createTeamRequest, listFreelancerTeamRequests } from "@/lib/gigxomi/app-team-flow-service";
import { prisma } from "@/lib/prisma";

import { loadEditors } from "@/lib/api/editor-directory";

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function isOutgoingRequest(value: unknown) { const metadata = record(value); return metadata.initiatedBy === "FREELANCER" || metadata.direction === "FREELANCER_TO_AGENCY"; }

function requestSenderName(value: unknown, fallback: string) {
  return text(record(value).createdByName) || fallback;
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;

  if (authorization.session.role === "FREELANCER") {
    const result = await listFreelancerTeamRequests(authorization.session);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    const requests = result.requests.map((request) => ({
      id: request.id,
      agencyId: request.tenantId,
      agencyName: request.agencyName,
      agencySlug: request.tenantId,
      agencyBrief: request.message || `${request.agencyName} wants to add you to its editor team.`,
      invitedByName: isOutgoingRequest(request.metadata) ? null : requestSenderName(request.metadata, request.agencyName),
      direction: isOutgoingRequest(request.metadata) ? "FREELANCER_TO_AGENCY" : "AGENCY_TO_FREELANCER",
      requestKind: record(request.metadata).requestKind === "WORK" ? "WORK" : "TEAM",
      status: request.status === "PENDING" || request.status === "SENT" ? isOutgoingRequest(request.metadata) ? "PENDING" : "INVITED" : request.status,
      assignmentEligible: request.status === "ACCEPTED",
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    }));
    const memberships = result.memberships.map((membership) => ({
      id: membership.id,
      agencyId: membership.tenantId,
      agencyName: membership.agencyName,
      agencySlug: membership.tenantId,
      agencyBrief: `${membership.agencyName} editor team membership.`,
      invitedByName: membership.agencyName,
      direction: "AGENCY_TO_FREELANCER",
      status: membership.status,
      assignmentEligible: membership.status === "ACTIVE",
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      ok: true,
      mode: "freelancer",
      requests: requests.filter((request) => request.status === "INVITED"),
      memberships: memberships.filter((membership) => membership.status === "ACTIVE"),
      history: [...requests.filter((request) => request.status !== "INVITED"), ...memberships.filter((membership) => membership.status !== "ACTIVE")],
    });
  }

  const tenantId = resolveSessionTenantId(authorization.session) || authorization.session.tenantId?.trim() || "tenant-gigxomi";
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") === "team" ? "team" : "general";
  const search = text(searchParams.get("search") || searchParams.get("q") || "").toLowerCase();
  const onlineOnly = searchParams.get("online") === "1";
  const requestedLimit = Number(searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.round(requestedLimit))) : 100;
  const requestedOffset = Number(searchParams.get("cursor") ?? 0);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.round(requestedOffset)) : 0;
  let allEditors: Awaited<ReturnType<typeof loadEditors>>;
  try { allEditors = await loadEditors(tenantId); }
  catch { return NextResponse.json({ ok: false, code: "DIRECTORY_UNAVAILABLE", error: "Editor profiles could not be loaded. Please retry." }, { status: 503 }); }
  const filteredEditors = allEditors.filter((editor) => {
    if (editor.isExternalInHouseRestricted) return false;
    if (scope === "team" && editor.membership?.status !== "ACTIVE") return false;
    if (scope === "general" && !editor.marketplaceEligible && !search) return false;
    if (onlineOnly && !editor.isOnline) return false;
    if (!search) return true;
    const searchTerms = search.split(/\s+/).filter(Boolean);
    const haystack = [editor.name, editor.title, editor.category, editor.bio, editor.workloadBand, editor.isOnline ? "online" : "offline", editor.trustScore, (editor as Record<string, unknown>).phone, ...editor.skills]
      .join(" ")
      .toLowerCase();
    return searchTerms.every((term) => haystack.includes(term));
  });
  filteredEditors.sort((a, b) => {
    if (Boolean(a.isOnline) !== Boolean(b.isOnline)) {
      return a.isOnline ? -1 : 1;
    }
    const aHasPortfolio = (a.portfolioLinks?.length ?? 0) > 0;
    const bHasPortfolio = (b.portfolioLinks?.length ?? 0) > 0;
    if (aHasPortfolio !== bHasPortfolio) {
      return aHasPortfolio ? -1 : 1;
    }
    return (b.trustScore ?? 0) - (a.trustScore ?? 0);
  });
  const editors = filteredEditors.slice(offset, offset + limit).map((editor) => {
    const { phone: _p, ...sanitized } = editor as Record<string, unknown>;
    return sanitized;
  });
  const nextOffset = offset + editors.length;

  return NextResponse.json({
    ok: true,
    mode: "agency",
    agency: { id: tenantId, name: authorization.session.displayName, slug: tenantId },
    scope,
    editors,
    totals: {
      general: allEditors.filter((editor) => editor.marketplaceEligible).length,
      active: allEditors.filter((editor) => editor.membership?.status === "ACTIVE").length,
      pending: allEditors.filter((editor) => editor.invitation && editor.membership?.status !== "ACTIVE").length,
    },
    invitations: allEditors.filter((editor) => editor.invitation && editor.membership?.status !== "ACTIVE").map((editor) => ({
      editorId: editor.id, editorName: editor.name, ...editor.invitation!,
    })),
    pageInfo: {
      total: filteredEditors.length,
      nextCursor: nextOffset < filteredEditors.length ? String(nextOffset) : null,
    },
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) return authorization.response;

  if (!authorization.session.tenantId?.trim()) return NextResponse.json({ ok: false, code: "TENANT_REQUIRED", error: "Choose an agency workspace to continue." }, { status: 403 });
  try {
  const body = await request.json().catch(() => ({}));
  const editorUserId = String(body?.editorUserId ?? body?.editorProfileId ?? "").trim();
  if (!editorUserId) {
    return NextResponse.json({ ok: false, error: "Choose an editor before sending an agency invite." }, { status: 400 });
  }

  const editor = await prisma.appAuthUser.findFirst({
    where: { id: editorUserId, OR: [{ role: "FREELANCER" }, { assignedRole: "FREELANCER" }] },
    select: { id: true },
  });
  if (!editor) {
    return NextResponse.json({ ok: false, error: "Editor profile not found." }, { status: 404 });
  }

  const tenantId = resolveSessionTenantId(authorization.session);
  const agencyBrief = text(body?.agencyBrief) || `${authorization.session.displayName} is inviting you to its editor team for upcoming client work.`;
  const result = await createTeamRequest(authorization.session, tenantId, {
    freelancerId: editorUserId,
    message: agencyBrief,
    roleType: text(body?.roleType) || "Video editor",
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, membership: result.request });
  } catch {
    return NextResponse.json({ ok: false, code: "TEAM_INVITE_UNAVAILABLE", error: "Your invitation could not be sent. Please retry." }, { status: 503 });
  }
}
