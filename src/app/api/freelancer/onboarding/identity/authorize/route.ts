import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { beginDigiLockerAuthorization, getAllowedDigiLockerDocumentTypes, isDigiLockerConfigured } from "@/lib/gigxomi/digilocker-service";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  return NextResponse.json({ ok: true, available: isDigiLockerConfigured(), documentTypes: getAllowedDigiLockerDocumentTypes() });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const body = await request.json();
  const result = await beginDigiLockerAuthorization(authorization.session.userId, body.documentType, body.returnTarget);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
