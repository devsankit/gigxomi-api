import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  listAllServicesFromFile,
  reviewFreelancerServiceFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status")?.trim();

  const allServices = await listAllServicesFromFile();
  const services = statusFilter
    ? allServices.filter(
        (service) =>
          service.status?.toLowerCase() === statusFilter.toLowerCase(),
      )
    : allServices;

  const counts = {
    all: allServices.length,
    pending: allServices.filter((s) => s.status === "Pending Review").length,
    approved: allServices.filter((s) => s.status === "Approved").length,
    rejected: allServices.filter((s) => s.status === "Rejected").length,
    draft: allServices.filter((s) => s.status === "Draft").length,
  };

  return NextResponse.json({
    ok: true,
    counts,
    services,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  let body: {
    serviceId?: string;
    action?: "APPROVE" | "REJECT";
    note?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Send a valid JSON review body." },
      { status: 400 },
    );
  }

  const { serviceId, action, note } = body;
  if (!serviceId || !action || (action !== "APPROVE" && action !== "REJECT")) {
    return NextResponse.json(
      { ok: false, error: "Service ID and valid action (APPROVE or REJECT) are required." },
      { status: 400 },
    );
  }

  const normalizedAction = action.toLowerCase() as "approve" | "reject";
  const updatedService = await reviewFreelancerServiceFromFile(
    serviceId,
    normalizedAction,
    note,
  );

  if (!updatedService) {
    return NextResponse.json(
      { ok: false, error: "Service not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    service: updatedService,
    message:
      action === "APPROVE"
        ? "Service has been approved and published to the marketplace."
        : "Service has been rejected with review notes.",
  });
}
