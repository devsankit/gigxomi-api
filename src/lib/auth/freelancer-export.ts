import type { ManagedAuthUser } from "./types";
import { formatManagedUserPhone } from "./managed-user-utils";
import type { FreelancerAdminProgress } from "@/lib/gigxomi/freelancer-admin-progress";

const FREELANCER_EXPORT_HEADERS = [
  "Name",
  "Email",
  "Phone",
  "Role",
  "Account status",
  "Package",
  "Registered date",
  "Package expiry",
  "Last activity",
  "Profile status",
  "Portfolio status",
  "Onboarding status",
] as const;

function formatExportDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function protectSpreadsheetCell(value: string) {
  return /^[\s]*[=+\-@]/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCsvCell(value: string) {
  return `"${protectSpreadsheetCell(value).replace(/"/g, '""')}"`;
}

export function buildFreelancerExportCsv(
  users: ManagedAuthUser[],
  progressByUser: Record<string, FreelancerAdminProgress> = {},
) {
  const rows = users.map((user) => {
    const progress = progressByUser[user.id];
    return [
      user.displayName || "Not provided",
      user.email || "Not provided",
      formatManagedUserPhone(user.phone),
      user.assignedRole === "ADMIN" ? "Agency admin" : user.role.replace(/_/g, " "),
      user.packageStatus ?? "PENDING",
      user.packageName ?? "Not assigned",
      formatExportDate(user.createdAt),
      formatExportDate(user.packageExpiresAt),
      formatExportDate(user.lastLoginAt),
      progress?.profileCompleted ? "COMPLETE" : "INCOMPLETE",
      progress?.portfolioStatus ?? "NOT_STARTED",
      progress?.onboardingCompleted ? "COMPLETE" : "IN_PROGRESS",
    ];
  });

  return `\uFEFF${[FREELANCER_EXPORT_HEADERS, ...rows]
    .map((row) => row.map((value) => escapeCsvCell(String(value))).join(","))
    .join("\r\n")}`;
}
