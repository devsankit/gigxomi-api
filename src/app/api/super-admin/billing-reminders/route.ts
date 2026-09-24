import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getSubscriptionReminderSettings, updateSubscriptionReminderSettings } from "@/lib/billing/subscription-reminder-settings-service";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const settings = await getSubscriptionReminderSettings();
  return NextResponse.json({ ok: true, settings });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    reminderDays?: string | number[];
  };

  const settings = await updateSubscriptionReminderSettings({
    enabled: body.enabled,
    reminderDays: body.reminderDays,
  });

  return NextResponse.json({ ok: true, settings });
}
