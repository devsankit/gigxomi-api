import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/session";
import { isRegistrationPackageFree } from "@/lib/billing/package-billing";
import { listActiveRegistrationPackages } from "@/lib/gigxomi/public-growth-store";

export async function GET() {
  const [session, packages] = await Promise.all([getSessionContext(), listActiveRegistrationPackages()]);
  const audience =
    session.role === "GUEST"
      ? null
      : session.packageAudience === "AGENCY" || session.workspaceMode === "AGENCY" || session.role === "ADMIN" || session.role === "MANAGER"
        ? "AGENCY"
        : "FREELANCER";
  return NextResponse.json({
    ok: true,
    session:
      session.role === "GUEST"
        ? null
        : {
            userId: session.userId,
            role: session.role,
            packageId: session.packageId,
            packageName: session.packageName,
            packageAudience: session.packageAudience,
            packageStatus: session.packageStatus,
            packageExpiresAt: session.packageExpiresAt,
            workspaceMode: session.workspaceMode,
          },
    audience,
    packages: packages.map((pkg) => ({
      ...pkg,
      isFree: isRegistrationPackageFree(pkg),
    })),
  });
}
