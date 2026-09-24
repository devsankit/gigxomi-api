import "server-only";

import type { SessionUser } from "@/lib/auth/types";
import {
  editorAgencyMemberships,
  editorPerformanceProfiles,
  type EditorAgencyMembership,
  type EditorPerformanceMetrics,
} from "@/lib/gigxomi/business-ecosystem-data";

type SessionLike = Pick<SessionUser, "userId" | "displayName" | "email" | "tenantId">;

export type ResolvedFreelancerChatIdentity = {
  editorId: string;
  candidateEditorIds: string[];
  candidateEditorNames: string[];
  editorName: string;
  profile: EditorPerformanceMetrics | null;
  memberships: EditorAgencyMembership[];
  activeAgencyIds: string[];
};

function normalizeKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function collapseKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveFreelancerProfile(session: SessionLike) {
  const normalizedUserId = normalizeKey(session.userId);
  const normalizedName = normalizeKey(session.displayName);
  const normalizedEmailLocalPart = normalizeKey(session.email?.split("@")[0] ?? "");
  const collapsedUserId = collapseKey(session.userId);
  const collapsedName = collapseKey(session.displayName);
  const collapsedEmailLocalPart = collapseKey(session.email?.split("@")[0] ?? "");

  return (
    editorPerformanceProfiles.find((editor) => normalizeKey(editor.id) === normalizedUserId) ??
    editorPerformanceProfiles.find((editor) => normalizeKey(editor.name) === normalizedName) ??
    editorPerformanceProfiles.find((editor) => normalizeKey(editor.publicAlias) === normalizedName) ??
    editorPerformanceProfiles.find((editor) => collapseKey(editor.id) === collapsedUserId && collapsedUserId) ??
    editorPerformanceProfiles.find((editor) => collapseKey(editor.name) === collapsedName && collapsedName) ??
    editorPerformanceProfiles.find((editor) => collapseKey(editor.publicAlias) === collapsedName && collapsedName) ??
    editorPerformanceProfiles.find((editor) => collapseKey(editor.name).includes(collapsedEmailLocalPart) && collapsedEmailLocalPart) ??
    editorPerformanceProfiles.find((editor) => normalizeKey(editor.name).includes(normalizedEmailLocalPart) && normalizedEmailLocalPart) ??
    null
  );
}

export function resolveFreelancerChatIdentity(session: SessionLike): ResolvedFreelancerChatIdentity {
  const profile = resolveFreelancerProfile(session);
  const editorId = profile?.id ?? session.userId;
  const candidateEditorIds = Array.from(new Set([profile?.id, session.userId].filter(Boolean))) as string[];
  const candidateEditorNames = Array.from(new Set([profile?.name, profile?.publicAlias, session.displayName].filter(Boolean))) as string[];
  const memberships = editorAgencyMemberships.filter((membership) => membership.editorId === editorId);
  const activeAgencyIds = Array.from(
    new Set(
      memberships
        .filter((membership) => membership.status === "Active")
        .map((membership) => membership.agencyId)
        .concat(session.tenantId ? [session.tenantId] : []),
    ),
  );

  return {
    editorId,
    candidateEditorIds,
    candidateEditorNames,
    editorName: profile?.name ?? session.displayName ?? "Freelancer",
    profile,
    memberships,
    activeAgencyIds,
  };
}
