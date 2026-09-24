import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { calculateFreelancerTrustScore, ensureFreelancerOnboarding } from "@/lib/gigxomi/freelancer-onboarding-service";
import { upsertFreelancerProfile } from "@/lib/gigxomi/freelancer-workspace-store";
import { prisma } from "@/lib/prisma";

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function list(value: unknown) { return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(",").map((item) => item.trim()).filter(Boolean); }

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const body = await request.json();
  const required = ["fullName", "displayName", "profileImageUrl", "bio", "experience", "location", "timezone", "availability"].filter((key) => !text(body[key]));
  if (!list(body.languages).length) required.push("languages");
  const onboarding = await ensureFreelancerOnboarding(authorization.session);
  const profession = text(body.profession) || onboarding.onboarding.primaryCategory || "";
  if (!profession) required.push("profession");
  if (required.length) return NextResponse.json({ ok: false, error: `Complete these profile fields: ${required.join(", ")}.` }, { status: 400 });
  const profileUrl = text(body.profileImageUrl);
  if (!profileUrl.startsWith("/") && !/^https:\/\//i.test(profileUrl)) return NextResponse.json({ ok: false, error: "Upload a valid profile photo." }, { status: 400 });
  const workspace = await upsertFreelancerProfile(authorization.session.userId, authorization.session, {
    fullName: text(body.fullName), displayName: text(body.displayName), profileImageUrl: profileUrl, bio: text(body.bio),
    experience: text(body.experience), languages: list(body.languages), location: text(body.location), timezone: text(body.timezone),
    availability: text(body.availability), profession, categories: [profession, ...onboarding.onboarding.secondaryCategories],
  });
  await prisma.appFreelancerOnboarding.update({ where: { userId: authorization.session.userId }, data: { profileCompletedAt: new Date(), profileDraft: Prisma.DbNull } });
  await calculateFreelancerTrustScore(authorization.session.userId);
  return NextResponse.json({ ok: true, profile: workspace.profile });
}
