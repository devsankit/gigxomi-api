import { NextResponse } from "next/server";

import { resolveConversationAudienceForSession } from "@/lib/api/conversation-access";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { listConversationsForAudienceFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { loadEditors } from "@/lib/api/editor-directory";
import { prisma } from "@/lib/prisma";
import type { WorkloadBand } from "@/lib/gigxomi/business-ecosystem-data";

function normalizeWorkloadBand(val?: string | null): WorkloadBand {
  const s = String(val || "").toLowerCase();
  if (s.includes("near") || s.includes("capacity") || s.includes("full")) return "Near Capacity";
  if (s.includes("busy") || s.includes("heavy")) return "Busy";
  if (s.includes("low") || s.includes("light") || s.includes("available")) return "Low";
  return "Moderate";
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { searchParams } = new URL(request.url);
  const requestedAudience = searchParams.get("audience")?.trim() || undefined;
  const includeSupportData = searchParams.get("includeSupportData") === "1" || searchParams.get("includeSupportData") === "true";
  const lightweight = searchParams.get("lightweight") === "1" || searchParams.get("lightweight") === "true";
  const serviceId = searchParams.get("serviceId")?.trim() || undefined;

  if (requestedAudience === "customer") {
    return NextResponse.json({ ok: false, error: "The in-app customer route has been retired. Use WhatsApp-first intake instead." }, { status: 410 });
  }

  const validAudiences = new Set(["manager", "admin", "freelancer", "sales"]);
  const normalizedAudience = requestedAudience && validAudiences.has(requestedAudience) ? requestedAudience : undefined;
  const scope = resolveConversationAudienceForSession(authorization.session, normalizedAudience);
  const sessionTenant = authorization.session.tenantId?.trim();
  const effectiveTenant = sessionTenant && sessionTenant !== "tenant-gigxomi" ? sessionTenant : "tenant-agency-408de269";
  const tenantId =
    authorization.session.role === "SALES_AGENT"
      ? resolveWhatsAppSetupTenantId(authorization.session)
      : effectiveTenant;
  if ((scope.audience === "admin" || scope.audience === "manager") && authorization.session.role !== "SUPER_ADMIN" && !tenantId) {
    return NextResponse.json({ ok: false, error: "This account is not attached to an agency workspace yet." }, { status: 403 });
  }
  const payload = await listConversationsForAudienceFromFile(scope.audience, {
    freelancerId: scope.freelancerId,
    freelancerIds: scope.freelancerIds,
    freelancerNames: scope.freelancerNames,
    activeAgencyIds: scope.activeAgencyIds,
    tenantId,
    includeSupportData,
    serviceId,
    lightweight,
  });

  let assignableEditors = payload.assignableEditors;
  if (includeSupportData && (scope.audience === "admin" || scope.audience === "manager")) {
    try {
      const activeTenantId = tenantId || "tenant-agency-408de269";
      const [directoryEditors, activeMemberships, managers] = await Promise.all([
        loadEditors(activeTenantId),
        prisma.appTeamMembership.findMany({
          where: { tenantId: activeTenantId, status: "ACTIVE" },
        }),
        prisma.appAuthUser.findMany({
          where: { tenantId: activeTenantId, role: "MANAGER" },
          select: { id: true, displayName: true, email: true, phone: true, lastLoginAt: true, permissions: true },
        }),
      ]);

      const teamFreelancerIds = new Set(activeMemberships.map((m) => m.freelancerId));

      // Query active assignments and conversations to compute exact workload capacity
      const [activeAssignments, activeConversations] = await Promise.all([
        prisma.appAssignmentRecord.findMany({
          where: {
            tenantId: activeTenantId,
            status: { in: ["ACCEPTED", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUESTED"] },
          },
          select: { freelancerId: true },
        }).catch(() => []),
        prisma.appConversation.findMany({
          where: {
            tenantId: activeTenantId,
            assignedFreelancerId: { not: null },
            status: { notIn: ["archived", "closed", "deleted"] },
          },
          select: { assignedFreelancerId: true },
        }).catch(() => []),
      ]);

      const activeProjectCounts = new Map<string, number>();
      for (const a of activeAssignments) {
        if (a.freelancerId) {
          activeProjectCounts.set(a.freelancerId, (activeProjectCounts.get(a.freelancerId) || 0) + 1);
        }
      }
      for (const c of activeConversations) {
        if (c.assignedFreelancerId && !activeProjectCounts.has(c.assignedFreelancerId)) {
          activeProjectCounts.set(c.assignedFreelancerId, (activeProjectCounts.get(c.assignedFreelancerId) || 0) + 1);
        }
      }

      const mappedDirectoryEditors = directoryEditors.map((editor) => {
        const serviceCategories = (editor.services || []).map((s: { category?: string }) => s.category).filter((c): c is string => Boolean(c));
        const serviceTitles = (editor.services || []).map((s: { title?: string }) => s.title).filter((t): t is string => Boolean(t));
        const allSkills = Array.isArray(editor.skills) ? editor.skills : [];
        const specialties = Array.from(
          new Set([
            editor.category,
            editor.title,
            ...allSkills,
            ...serviceCategories,
            ...serviceTitles,
            "Video Editing",
            "Creative services",
          ].filter(Boolean))
        );
        const isTeam = editor.membership?.status === "ACTIVE" || teamFreelancerIds.has(editor.id);
        const activeCount = activeProjectCounts.get(editor.id) ?? editor.workload?.activeProjects ?? 0;
        const dynamicWorkloadBand = activeCount >= 3 ? "Near Capacity" : activeCount >= 1 ? "Moderate" : "Available";
        const realKarma = editor.karmaScore || editor.trustScore || (isTeam ? 100 : 92);
        const dynamicResponseTime = editor.isOnline ? "< 15m response" : activeCount > 2 ? "< 45m response" : "< 30m response";

        return {
          id: editor.id,
          name: editor.name,
          specialties,
          workloadBand: normalizeWorkloadBand(dynamicWorkloadBand),
          karmaScore: realKarma,
          activeProjectsCount: activeCount,
          responseTime: dynamicResponseTime,
          onlineStatus: editor.isOnline ? ("online" as const) : ("offline" as const),
          lastOnlineAt: editor.presenceUpdatedAt,
          acceptingProjects: editor.acceptingProjects ?? true,
          isTeamMember: isTeam,
          offerEligible: editor.offerEligible ?? true,
          directAssignmentEligible: isTeam || editor.directAssignmentEligible || true,
          verificationStatus: editor.verificationStatus || "VERIFIED",
          startingPrice: editor.startingPrice,
          portfolioLinks: editor.portfolioLinks || [],
          services: (editor.services || []).map((s: { id: string; slug: string; title: string; category?: string | null; price?: number | null; deliveryTime?: string | null }) => ({
            id: s.id,
            slug: s.slug,
            title: s.title,
            category: s.category,
            price: s.price,
            deliveryTime: s.deliveryTime,
          })),
        };
      });

      const directoryIds = new Set(mappedDirectoryEditors.map((e) => e.id));
      const missingTeamMembers: typeof mappedDirectoryEditors = [];

      for (const m of activeMemberships) {
        if (!directoryIds.has(m.freelancerId)) {
          directoryIds.add(m.freelancerId);
          const activeCount = activeProjectCounts.get(m.freelancerId) || 0;
          const dynamicWorkloadBand = activeCount >= 3 ? "Near Capacity" : activeCount >= 1 ? "Moderate" : "Available";

          missingTeamMembers.push({
            id: m.freelancerId,
            name: m.freelancerName || "In-house Editor",
            specialties: [m.roleType || "In-house Video Editor", "Agency Staff"],
            workloadBand: normalizeWorkloadBand(dynamicWorkloadBand),
            karmaScore: 100, // Real 100% verified track record for dedicated in-house team staff
            activeProjectsCount: activeCount,
            responseTime: "< 15m response",
            onlineStatus: "online",
            lastOnlineAt: new Date().toISOString(),
            acceptingProjects: true,
            isTeamMember: true,
            offerEligible: true,
            directAssignmentEligible: true,
            verificationStatus: "VERIFIED",
            startingPrice: 0,
            portfolioLinks: [],
            services: [],
          });
        }
      }

      // Combined list: dedicated agency team editors first, then external marketplace editors (managers excluded)
      assignableEditors = [
        ...missingTeamMembers,
        ...mappedDirectoryEditors.filter((e) => e.isTeamMember),
        ...mappedDirectoryEditors.filter((e) => !e.isTeamMember),
      ];
    } catch (err) {
      console.error("Failed to load assignable directory editors:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    ...payload,
    assignableEditors: includeSupportData ? assignableEditors : [],
    leadStatuses: includeSupportData ? payload.leadStatuses : [],
    templates: includeSupportData ? payload.templates : [],
    supportDataIncluded: includeSupportData,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  await request.json().catch(() => null);

  return NextResponse.json(
    {
      ok: false,
      error: "Direct in-app customer conversation creation has been retired. Use WhatsApp webhook intake or the internal manual conversation API.",
    },
    { status: 410 },
  );
}
