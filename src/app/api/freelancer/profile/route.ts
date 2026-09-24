import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { getFreelancerWorkspaceState, upsertFreelancerProfile } from "@/lib/gigxomi/freelancer-workspace-store";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const workspace = await getFreelancerWorkspaceState(authorization.session.userId, {
    userId: authorization.session.userId,
    displayName: authorization.session.displayName,
    email: authorization.session.email,
    phone: authorization.session.phone,
  });

  const identity = await prisma.appFreelancerIdentity.findUnique({ where: { userId: authorization.session.userId }, select: { status: true, documentType: true } });

  const teamMembership = await prisma.appTeamMembership.findFirst({
    where: {
      freelancerId: authorization.session.userId,
      status: "ACTIVE",
    },
  });

  return NextResponse.json({
    ok: true,
    profile: {
      ...workspace.profile,
      identityVerified: identity?.status === "VERIFIED",
      identityDocumentType: identity?.documentType ?? null,
      isAgencyInvited: Boolean(teamMembership),
      agencyName: teamMembership?.agencyName ?? null,
      agencyPermissions: teamMembership?.permissions ?? [],
      agencyRoleType: teamMembership?.roleType ?? null,
    },
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const body = await request.json();
  const workspace = await upsertFreelancerProfile(
    authorization.session.userId,
    {
      userId: authorization.session.userId,
      displayName: authorization.session.displayName,
      email: authorization.session.email,
      phone: authorization.session.phone,
    },
    {
      fullName: body.fullName,
      displayName: body.displayName,
      phone: body.phone,
      profession: body.profession,
      languages: body.languages,
      englishLevel: body.englishLevel,
      bio: body.bio,
      email: body.email,
      profileImageUrl: body.profileImageUrl,
      skills: body.skills,
      categories: body.categories,
      experience: body.experience,
      portfolioLinks: body.portfolioLinks,
      availability: body.availability,
      pricing: body.pricing,
      preferredWorkType: body.preferredWorkType,
      location: body.location,
      timezone: body.timezone,
    },
  );

  const identity = await prisma.appFreelancerIdentity.findUnique({ where: { userId: authorization.session.userId }, select: { status: true, documentType: true } });
  return NextResponse.json({
    ok: true,
    profile: { ...workspace.profile, identityVerified: identity?.status === "VERIFIED", identityDocumentType: identity?.documentType ?? null },
  });
}
