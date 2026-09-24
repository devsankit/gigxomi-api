import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { getCustomerPrivacySettingsFromFile, updateCustomerPrivacySettingsFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const tenantId = resolveSessionTenantId(authorization.session);
  const settings = await getCustomerPrivacySettingsFromFile(tenantId);

  return NextResponse.json({
    ok: true,
    settings,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json().catch(() => ({}));
  const tenantId = resolveSessionTenantId(authorization.session);
  const settings = await updateCustomerPrivacySettingsFromFile(tenantId, {
    maskCustomerPhoneForManagers:
      typeof body.maskCustomerPhoneForManagers === "boolean" ? body.maskCustomerPhoneForManagers : undefined,
    maskCustomerPhoneForFreelancers:
      typeof body.maskCustomerPhoneForFreelancers === "boolean" ? body.maskCustomerPhoneForFreelancers : undefined,
  });

  return NextResponse.json({
    ok: true,
    settings,
  });
}
