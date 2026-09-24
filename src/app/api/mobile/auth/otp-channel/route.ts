import { NextResponse } from "next/server";

import {
  buildPublicAuthWhatsAppHref,
  getPublicAuthOtpChannelInfo,
  getPublicAuthOtpCommand,
} from "@/lib/auth/public-whatsapp";

export async function GET() {
  const [channel, whatsappHref] = await Promise.all([getPublicAuthOtpChannelInfo(), buildPublicAuthWhatsAppHref()]);

  return NextResponse.json({
    ok: true,
    command: getPublicAuthOtpCommand(),
    label: channel.label,
    whatsappHref,
    isConfigured: channel.isConfigured,
  });
}
