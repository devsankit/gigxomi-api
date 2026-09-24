import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { loadEditors } from "@/lib/api/editor-directory";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const tenantId = authorization.session.tenantId?.trim() || "tenant-gigxomi";
  const { id } = await context.params;
  const decodedId = decodeURIComponent(id || "").trim();
  try {
    const [editor] = await loadEditors(tenantId, decodedId);
    if (!editor) {
      return NextResponse.json({ ok: false, code: "EDITOR_NOT_VISIBLE", error: "This editor profile is no longer available." }, { status: 404 });
    }
    // Strictly sanitize contact details to protect freelancer privacy
    const { phone: _privatePhone, ...sanitizedEditor } = editor as Record<string, unknown>;
    return NextResponse.json({ ok: true, editor: sanitizedEditor });
  } catch (err) {
    console.error("Failed to load editor profile:", err);
    return NextResponse.json({ ok: false, code: "DIRECTORY_UNAVAILABLE", error: "This profile could not be loaded. Please retry." }, { status: 503 });
  }
}
