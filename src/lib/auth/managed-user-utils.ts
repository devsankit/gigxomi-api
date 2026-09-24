import type { ManagedAuthUser } from "./types";

export type ManagedUserAudience = "AGENCY" | "FREELANCER";

export function isManagedUserInAudience(user: ManagedAuthUser, audience: ManagedUserAudience) {
  if (user.role === "SUPER_ADMIN") {
    return false;
  }

  if (audience === "AGENCY") {
    return (
      user.packageAudience === "AGENCY" ||
      user.workspaceMode === "AGENCY" ||
      user.role === "ADMIN" ||
      user.assignedRole === "ADMIN"
    );
  }

  return user.packageAudience === "FREELANCER" || (user.role === "FREELANCER" && user.packageAudience !== "AGENCY");
}

export function formatManagedUserPhone(value: string | null | undefined) {
  const rawValue = value?.trim() ?? "";
  const digits = rawValue.replace(/\D/g, "");

  if (digits.length < 4) {
    return "Not provided";
  }

  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }

  return rawValue.startsWith("+") ? rawValue : `+${digits}`;
}
