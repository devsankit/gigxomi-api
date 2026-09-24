import type { AppRole, SessionUser } from "@/lib/auth/types";

export type ConnectedAudienceValue = "CRM" | "AGENCY" | "FREELANCER";

export function audienceForSession(session: Pick<SessionUser, "role" | "workspaceMode" | "packageAudience">): ConnectedAudienceValue {
  if (session.role === "SALES_AGENT") return "CRM";
  if (session.workspaceMode === "AGENCY" || session.packageAudience === "AGENCY" || session.role === "ADMIN") return "AGENCY";
  return "FREELANCER";
}
export function allowedRolesForAudience(audience: ConnectedAudienceValue): AppRole[] {
  if (audience === "CRM") return ["SALES_AGENT", "SUPER_ADMIN"];
  if (audience === "AGENCY") return ["ADMIN", "SUPER_ADMIN"];
  return ["FREELANCER", "SUPER_ADMIN"];
}
