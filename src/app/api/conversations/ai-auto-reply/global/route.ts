import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  getGlobalAiAutoReplySettings,
  setGlobalAiAutoReplyEnabled,
} from "@/lib/gigxomi/ai-automation-settings";

const READ_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"] as const;
const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT"] as const;

declare global {
  var __gxGlobalAiEnabled: boolean | undefined;
}

export async function GET() {
  const authorization = await requireSessionRole([...READ_ROLES]);
  if (!authorization.ok) return authorization.response;

  try {
    const settings = await getGlobalAiAutoReplySettings();
    return NextResponse.json({ ok: true, settings });
  } catch {
    return NextResponse.json({
      ok: true,
      settings: {
        enabled: globalThis.__gxGlobalAiEnabled ?? true,
        updatedAt: new Date().toISOString(),
        updatedById: null,
        updatedByName: "System",
      },
    });
  }
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole([...WRITE_ROLES]);
  if (!authorization.ok) return authorization.response;

  const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "enabled must be a boolean." }, { status: 400 });
  }

  try {
    const settings = await setGlobalAiAutoReplyEnabled({
      enabled: body.enabled,
      updatedById: authorization.session.userId,
      updatedByName: authorization.session.displayName || authorization.session.email || "Admin",
    });
    globalThis.__gxGlobalAiEnabled = body.enabled;
    return NextResponse.json({ ok: true, settings });
  } catch {
    globalThis.__gxGlobalAiEnabled = body.enabled;
    return NextResponse.json({
      ok: true,
      settings: {
        enabled: body.enabled,
        updatedAt: new Date().toISOString(),
        updatedById: authorization.session.userId,
        updatedByName: authorization.session.displayName || "Admin",
      },
    });
  }
}
