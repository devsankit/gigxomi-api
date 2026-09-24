import "server-only";

import type { ManagedAuthUser } from "@/lib/auth/types";
import { editorPerformanceProfiles } from "@/lib/gigxomi/business-ecosystem-data";

export type FreelancerPushRecipient = {
  displayName: string;
  editorId: string;
  pushUserId: string | null;
};

function normalizeIdentity(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isFreelancer(user: ManagedAuthUser) {
  return user.role === "FREELANCER" || user.assignedRole === "FREELANCER";
}

export function resolveFreelancerPushRecipients(editorIds: string[], managedUsers: ManagedAuthUser[]): FreelancerPushRecipient[] {
  const freelancerUsers = managedUsers.filter(isFreelancer);

  return Array.from(new Set(editorIds.map((value) => value.trim()).filter(Boolean)))
    .map((editorId) => {
      const directUser = freelancerUsers.find((user) => user.id === editorId) ?? null;
      const editorProfile = editorPerformanceProfiles.find((editor) => editor.id === editorId) ?? null;
      const profileUser = editorProfile
        ? freelancerUsers.find((user) => normalizeIdentity(user.displayName) === normalizeIdentity(editorProfile.name)) ?? null
        : null;
      const authUser = directUser ?? profileUser;

      if (!authUser && !editorProfile) {
        return null;
      }

      return {
        displayName: authUser?.displayName || editorProfile?.name || editorId,
        editorId,
        pushUserId: authUser?.id ?? null,
      };
    })
    .filter((recipient): recipient is FreelancerPushRecipient => Boolean(recipient));
}
