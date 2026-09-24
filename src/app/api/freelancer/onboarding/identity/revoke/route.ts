import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { revokeDigiLockerVerification } from "@/lib/gigxomi/digilocker-service";

export async function POST() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  await revokeDigiLockerVerification(authorization.session.userId);
  return NextResponse.json({ ok: true });
}
