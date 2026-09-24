import "server-only";

import { getEffectiveBillingPackageForUser } from "@/lib/billing/billing-access-service";
import { prisma } from "@/lib/prisma";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "DRAFT",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "UNDER_REVIEW",
  "REVISION_REQUESTED",
];

export async function assertFreelancerActiveProjectCapacity(freelancerId: string) {
  const effective = await getEffectiveBillingPackageForUser(freelancerId);
  if (effective && !effective.package.isFree && effective.package.billingType !== "FREE") {
    return { ok: true as const, limit: null };
  }
  const activeProjects = await prisma.appAssignmentRecord.count({
    where: { freelancerId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
  });
  const limit = 2;
  if (activeProjects >= limit) {
    return {
      ok: false as const,
      status: 402,
      limit,
      activeProjects,
      error: "This freelancer's free plan includes 2 active assigned projects. Ask them to upgrade their package before assigning another project.",
    };
  }
  return { ok: true as const, limit, activeProjects };
}
