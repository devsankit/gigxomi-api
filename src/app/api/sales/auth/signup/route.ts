import { NextResponse } from "next/server";

import { createSalesAgentAccount, getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Send valid sales signup details." }, { status: 400 });
  }

  const displayName = readString(body.displayName);
  const email = readString(body.email);
  const phone = readString(body.phone);
  const password = readString(body.password);
  const confirmPassword = readString(body.confirmPassword);
  if (password !== confirmPassword) {
    return NextResponse.json({ ok: false, error: "Passwords do not match." }, { status: 400 });
  }
  const snapshot = await getSalesSnapshotForRole({ role: "GUEST", userId: null });
  if (!snapshot.settings.moduleEnabled) {
    return NextResponse.json({ ok: false, error: "Sales signup is currently disabled." }, { status: 503 });
  }

  const created = await createSalesAgentAccount({
    displayName,
    email,
    phone,
    password,
    status: snapshot.settings.signupRequiresApproval ? "PENDING" : "ACTIVE",
  });

  if (!created.ok) {
    return NextResponse.json(created, { status: 400 });
  }

  return NextResponse.json(created);
}
