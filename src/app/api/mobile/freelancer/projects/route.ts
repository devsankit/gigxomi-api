import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getAgencyListingsForFreelancerFromFile } from "@/lib/gigxomi/agency-listing-store";
import { getFreelancerDashboardSnapshot } from "@/lib/gigxomi/business-ecosystem-data";

type MobileProjectApplyBody = {
  projectId?: unknown;
};

function readBodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const snapshot = getFreelancerDashboardSnapshot();
  const agencies = await getAgencyListingsForFreelancerFromFile();
  const agencyMap = new Map(agencies.map((agency) => [agency.tenantId, agency]));
  const applicationMap = new Map(snapshot.applications.map((application) => [application.projectId, application]));

  const projects = snapshot.opportunities.map((project) => {
    const agency = agencyMap.get(project.agencyId);
    const application = applicationMap.get(project.id);
    const location = [agency?.office.city, agency?.office.state].filter(Boolean).join(", ");

    return {
      ...project,
      applicationStatus: application?.status ?? null,
      agencyTrust: agency
        ? {
            score: agency.reputation.score,
            band: agency.reputation.band,
            responseSla: `${agency.stats.responseSlaMinutes} min avg`,
            repeatClients: `${agency.stats.repeatClientPercent}% repeat clients`,
            location: location || agency.office.country,
          }
        : null,
    };
  });

  return NextResponse.json({ ok: true, projects });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  let body: MobileProjectApplyBody;

  try {
    body = (await request.json()) as MobileProjectApplyBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Send a valid JSON project application body." }, { status: 400 });
  }

  const projectId = readBodyString(body.projectId).trim();
  const snapshot = getFreelancerDashboardSnapshot();
  const project = snapshot.opportunities.find((item) => item.id === projectId);

  if (!project) {
    return NextResponse.json({ ok: false, error: "Project is not available for this freelancer." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    application: {
      id: `mobile-apply-${project.id}`,
      projectId: project.id,
      status: "Applied",
      note: "Application received. Agency team membership must be active before work can start.",
    },
  });
}
