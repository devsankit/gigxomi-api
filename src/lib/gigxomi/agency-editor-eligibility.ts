import type { ManagedAuthUser } from "@/lib/auth/types";

export type ConfirmedAgencyEditorIdentity = {
  editorProfileId: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  category?: string | null;
  karmaScore?: number | null;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePhone(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export function isAssignableManagedFreelancer(user: ManagedAuthUser) {
  // Agency team membership is the assignment entitlement. A freelancer's
  // marketplace/package state must not remove an ACTIVE, confirmed team member
  // from the agency chat picker or make an existing client handoff impossible.
  return user.role === "FREELANCER" || user.assignedRole === "FREELANCER";
}

export function findConfirmedAgencyEditorForManagedUser(
  user: ManagedAuthUser,
  confirmedEditors: readonly ConfirmedAgencyEditorIdentity[],
) {
  if (!isAssignableManagedFreelancer(user)) {
    return null;
  }

  const userEmail = normalizeText(user.email);
  const userPhone = normalizePhone(user.phone);
  const userName = normalizeText(user.displayName);
  const uniqueMatch = (matches: ConfirmedAgencyEditorIdentity[]) => (matches.length === 1 ? matches[0] : null);

  // Prefer authoritative identifiers. The same person can legitimately exist
  // in both the current app-team table and the legacy editor-profile table;
  // an exact app user ID must not become ambiguous because the legacy record
  // also shares their name or contact details.
  const idMatch = uniqueMatch(confirmedEditors.filter((editor) => editor.editorProfileId === user.id));
  if (idMatch) return idMatch;

  if (userEmail) {
    const emailMatch = uniqueMatch(confirmedEditors.filter((editor) => normalizeText(editor.email) === userEmail));
    if (emailMatch) return emailMatch;
  }

  if (userPhone) {
    const phoneMatch = uniqueMatch(confirmedEditors.filter((editor) => normalizePhone(editor.phone) === userPhone));
    if (phoneMatch) return phoneMatch;
  }

  if (userName) {
    return uniqueMatch(confirmedEditors.filter((editor) => normalizeText(editor.displayName) === userName));
  }

  return null;
}
