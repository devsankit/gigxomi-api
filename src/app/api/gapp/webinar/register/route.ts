import { NextResponse } from "next/server";

import { registerForGappWebinar } from "@/lib/gigxomi/gapp-webinar-store";
import { enqueueMetaConversion } from "@/lib/meta/conversions-api";
import { websiteConversionContext } from "@/lib/meta/website-conversion";
import { websiteSource } from "@/lib/meta/conversion-contract";

type RegisterBody = {
  currentMonthlyProjects?: unknown;
  email?: unknown;
  fullName?: unknown;
  participantType?: unknown;
  sourcePath?: unknown;
  whatsappNumber?: unknown;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as RegisterBody | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Registration details are required." }, { status: 400 });
  }

  try {
    const result = await registerForGappWebinar({
      currentMonthlyProjects: readString(body.currentMonthlyProjects),
      email: readString(body.email),
      fullName: readString(body.fullName),
      participantType: readString(body.participantType),
      sourcePath: readString(body.sourcePath),
      userAgent: request.headers.get("user-agent"),
      whatsappNumber: readString(body.whatsappNumber),
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    // Only a server-created registration can generate a conversion. Opening checkout is not a sale.
    const context = websiteConversionContext(request, `${request.headers.get("origin") ?? ""}${readString(body.sourcePath) || "/"}`);
    const eventId = `registration_${result.registrationId}`;
    const eventName = "merchantTransactionId" in result ? "Lead" : "CompleteRegistration";
    const tracking = context ? await enqueueMetaConversion({ eventId, eventName, source: websiteSource(context.url), eventSourceUrl: context.url,
      userData: { ...context.userData, phone: readString(body.whatsappNumber), email: readString(body.email) },
    }).catch(() => ({ queued: false })) : null;
    return NextResponse.json({ ...result, ...(tracking?.queued ? { metaEvent: { eventId, eventName } } : {}) });
  } catch (error) {
    console.error("[gapp] Registration failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Registration could not be completed right now.",
      },
      { status: 500 },
    );
  }
}
