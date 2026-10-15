import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  getStatusLabels,
  createStatusLabel,
  updateStatusLabel,
  deleteStatusLabel,
  toggleLeadStatusLabel,
  updateLeadTags,
} from "@/lib/gigxomi/status-labels-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const isDev =
    process.env.NODE_ENV !== "production" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";

  const auth = await requireSessionRole(["SALES_AGENT", "ADMIN", "SUPER_ADMIN", "MANAGER", "FREELANCER"]);
  if (!auth.ok && !isDev) return auth.response;

  try {
    const labels = await getStatusLabels();
    return NextResponse.json({ ok: true, labels });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load status labels" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const isDev =
    process.env.NODE_ENV !== "production" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";

  const auth = await requireSessionRole(["SALES_AGENT", "ADMIN", "SUPER_ADMIN", "MANAGER", "FREELANCER"]);
  if (!auth.ok && !isDev) return auth.response;

  try {
    const body = await request.json();

    // Check if toggling on a lead
    if (body.action === "toggle" && body.leadId && body.labelName) {
      const nextTags = await toggleLeadStatusLabel(String(body.leadId), String(body.labelName));
      return NextResponse.json({ ok: true, tags: nextTags });
    }

    // Creating a new label
    const label = await createStatusLabel({
      name: String(body.name || ""),
      color: String(body.color || "#ff6b2f"),
      description: body.description ? String(body.description) : undefined,
    });
    return NextResponse.json({ ok: true, label });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create status label" },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const isDev =
    process.env.NODE_ENV !== "production" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";

  const auth = await requireSessionRole(["SALES_AGENT", "ADMIN", "SUPER_ADMIN", "MANAGER", "FREELANCER"]);
  if (!auth.ok && !isDev) return auth.response;

  try {
    const body = await request.json();

    // Check if updating tags on a lead directly
    if (body.leadId && Array.isArray(body.tags)) {
      const nextTags = await updateLeadTags(String(body.leadId), body.tags);
      return NextResponse.json({ ok: true, tags: nextTags });
    }

    const id = String(body.id || "");
    if (!id) return NextResponse.json({ ok: false, error: "Label ID is required." }, { status: 400 });

    const label = await updateStatusLabel(id, {
      name: body.name ? String(body.name) : undefined,
      color: body.color ? String(body.color) : undefined,
      description: body.description !== undefined ? String(body.description) : undefined,
    });
    return NextResponse.json({ ok: true, label });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update status label" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const isDev =
    process.env.NODE_ENV !== "production" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";

  const auth = await requireSessionRole(["SALES_AGENT", "ADMIN", "SUPER_ADMIN", "MANAGER", "FREELANCER"]);
  if (!auth.ok && !isDev) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "Label ID is required." }, { status: 400 });

    const result = await deleteStatusLabel(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to delete status label" },
      { status: 400 }
    );
  }
}
