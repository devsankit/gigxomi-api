import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { clearImpersonationCookies } from "@/lib/auth/impersonation";
import { clearSessionCookie } from "@/lib/auth/session";
import { deleteAgencyListingFromFile, getAgencyListingByTenantIdFromFile } from "@/lib/gigxomi/agency-listing-store";
import { prisma } from "@/lib/prisma";

export async function DELETE(request: Request) {
  return handleAccountDeletion(request);
}

export async function POST(request: Request) {
  return handleAccountDeletion(request);
}

async function handleAccountDeletion(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const tenantId = authorization.session.tenantId || "";
  const userId = authorization.session.userId;

  if (!userId) {
    return NextResponse.json({ ok: false, error: "Missing user identity" }, { status: 400 });
  }

  let body: { confirmText?: string } = {};
  try {
    body = (await request.json()) as { confirmText?: string };
  } catch {
    // allow empty body if DELETE
  }

  // Fetch current agency profile to verify confirmation
  const existingProfile = tenantId ? await getAgencyListingByTenantIdFromFile(tenantId) : null;
  const expectedConfirm = existingProfile?.publicName || existingProfile?.slug || "DELETE";

  const rawConfirm = (body.confirmText || "").trim().toLowerCase();
  const isDeleteKeyword = rawConfirm === "delete";
  const isNameMatch = rawConfirm === expectedConfirm.toLowerCase();

  if (!isDeleteKeyword && !isNameMatch) {
    return NextResponse.json(
      {
        ok: false,
        error: `Please confirm deletion by typing "${expectedConfirm}" or "DELETE".`,
      },
      { status: 400 },
    );
  }

  try {
    // 1. Remove from agency listing file store
    if (tenantId) {
      await deleteAgencyListingFromFile(tenantId);
    }

    // 2. Disconnect / delete team memberships for this agency
    if (tenantId) {
      await (prisma as any).appTeamMembership.deleteMany({
        where: {
          OR: [
            { tenantId },
            ...(existingProfile?.publicName ? [{ agencyName: existingProfile.publicName }] : []),
          ],
        },
      }).catch(() => null);

      // 3. Delete any generated API tokens
      await (prisma as any).appAgencyApiToken.deleteMany({
        where: { tenantId },
      }).catch(() => null);
    }

    // 4. Delete connected onboarding state & subscriptions
    await prisma.connectedOnboardingState.deleteMany({
      where: { userId },
    }).catch(() => null);

    await prisma.userSubscription.deleteMany({
      where: { userId },
    }).catch(() => null);

    // 5. Try deleting the user account from AppAuthUser, or mark as completely purged
    try {
      await prisma.appAuthUser.delete({
        where: { id: userId },
      });
    } catch {
      // If foreign keys (chats, logs) exist, sanitize and disable permanently
      await (prisma as any).appAuthUser.update({
        where: { id: userId },
        data: {
          displayName: "Deleted Agency",
          role: "FREELANCER",
          assignedRole: "FREELANCER",
          packageAudience: null,
          packageStatus: "EXPIRED",
          workspaceMode: null,
          tenantId: null,
          email: null,
          phone: `deleted-${Date.now()}-${authorization.session.phone}`,
        },
      }).catch(() => null);
    }

    // 6. Return response and wipe authentication cookies
    const response = NextResponse.json({
      ok: true,
      message: "Agency account and workspace deleted successfully.",
    });

    clearSessionCookie(response);
    clearImpersonationCookies(response);

    return response;
  } catch (error) {
    console.error("Failed to delete agency account:", error);
    return NextResponse.json(
      { ok: false, error: "An error occurred while deleting the agency account." },
      { status: 500 },
    );
  }
}
