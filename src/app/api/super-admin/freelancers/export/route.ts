import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { buildFreelancerExportCsv } from "@/lib/auth/freelancer-export";
import { getManagedAuthUsers } from "@/lib/auth/store";
import { isManagedUserInAudience } from "@/lib/auth/managed-user-utils";
import { getFreelancerAdminProgress } from "@/lib/gigxomi/freelancer-admin-progress";

type ExportRequest =
  | { scope: "all" }
  | { scope: "visible"; userIds: string[] };

function isExportRequest(value: unknown): value is ExportRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const request = value as { scope?: unknown; userIds?: unknown };
  if (request.scope === "all") {
    return true;
  }

  return request.scope === "visible" && Array.isArray(request.userIds) && request.userIds.every((id) => typeof id === "string");
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json().catch(() => null);
  if (!isExportRequest(body)) {
    return NextResponse.json({ ok: false, error: "A valid export scope is required." }, { status: 400 });
  }

  const users = (await getManagedAuthUsers())
    .filter((user) => isManagedUserInAudience(user, "FREELANCER"))
    .slice()
    .sort((left, right) => {
      const createdAtDifference = Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "");
      return Number.isFinite(createdAtDifference) && createdAtDifference !== 0
        ? createdAtDifference
        : left.displayName.localeCompare(right.displayName);
    });

  const visibleIds = body.scope === "visible" ? new Set(body.userIds) : null;
  const exportedUsers = visibleIds ? users.filter((user) => visibleIds.has(user.id)) : users;
  const progress = await getFreelancerAdminProgress(exportedUsers.map((user) => user.id));
  const csv = buildFreelancerExportCsv(exportedUsers, progress);
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="gigxomi-freelancers-${date}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
