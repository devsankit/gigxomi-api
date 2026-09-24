import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { GAPP_SALES_WEBINAR_ID, updateGappWebinar } from "@/lib/gigxomi/gapp-webinar-store";
import { getSalesOperatingSnapshot, saveSalesWebinar } from "@/lib/gigxomi/sales-operating-system-store";
import { prisma } from "@/lib/prisma";

function isHomepageRegistrationLink(value: unknown) {
  const link = typeof value === "string" ? value.trim() : "";
  if (link === "/webinar" || link.startsWith("/webinar?") || link === "/agency-growth" || link.startsWith("/agency-growth?")) return true;
  if (!link) return false;
  try {
    const pathname = new URL(link).pathname;
    return pathname === "/webinar" || pathname === "/agency-growth";
  } catch {
    return false;
  }
}

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const snapshot = await getSalesOperatingSnapshot(authorization.session);
  return NextResponse.json({ ok: true, webinars: snapshot.webinars, invites: snapshot.webinarInvites });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Send valid webinar details." }, { status: 400 });

  try {
    const requestedId = typeof body.id === "string" ? body.id.trim() : "";
    const publishToHomepage = requestedId === GAPP_SALES_WEBINAR_ID || body.publishToHomepage === true || isHomepageRegistrationLink(body.registrationLink);
    const currentAgent = authorization.session.role === "SALES_AGENT"
      ? await prisma.salesAgentProfile.findUnique({
          where: { userId: authorization.session.userId },
          select: { id: true, status: true },
        })
      : null;

    if (authorization.session.role === "SALES_AGENT" && (!currentAgent || currentAgent.status !== "ACTIVE")) {
      return NextResponse.json({ ok: false, error: "An active sales profile is required to schedule webinars." }, { status: 403 });
    }

    if (authorization.session.role === "SALES_AGENT" && requestedId && !publishToHomepage) {
      const existing = await prisma.salesWebinar.findUnique({ where: { id: requestedId }, select: { hostId: true } });
      if (!existing) return NextResponse.json({ ok: false, error: "Webinar not found." }, { status: 404 });
      if (existing.hostId !== currentAgent?.id) {
        return NextResponse.json({ ok: false, error: "You can only reschedule webinars that you host." }, { status: 403 });
      }
    }

    if (publishToHomepage) {
      const title = String(body.title ?? "").trim().slice(0, 160);
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "";
      const startsAt = new Date(String(body.startsAt ?? ""));
      if (!title || Number.isNaN(startsAt.getTime())) {
        return NextResponse.json({ ok: false, error: "Homepage webinar needs a title and valid date and time." }, { status: 400 });
      }
      if (startsAt.getTime() < Date.now() + 5 * 60 * 1000) {
        return NextResponse.json({ ok: false, error: "Choose a webinar time at least 5 minutes in the future." }, { status: 400 });
      }

      await updateGappWebinar({
        countdownEnabled: true,
        description,
        registrationEnabled: body.isActive !== false,
        scheduledAt: startsAt.toISOString(),
        title,
      });
      const webinar = await prisma.salesWebinar.findUnique({ where: { id: GAPP_SALES_WEBINAR_ID } });
      return NextResponse.json({ ok: true, homepageUpdated: true, webinar });
    }

    const webinar = await saveSalesWebinar({
      id: requestedId || undefined,
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : "",
      hostId: authorization.session.role === "SALES_AGENT" ? currentAgent?.id ?? null : typeof body.hostId === "string" ? body.hostId : null,
      startsAt: String(body.startsAt ?? ""),
      registrationLink: typeof body.registrationLink === "string" ? body.registrationLink : "",
      isActive: body.isActive !== false,
    });
    return NextResponse.json({ ok: true, webinar });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save webinar." }, { status: 400 });
  }
}
