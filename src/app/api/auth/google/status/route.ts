import { NextResponse } from "next/server";
import { isGoogleOAuthAvailable } from "@/lib/auth/google-oauth";

export async function GET() {
  return NextResponse.json({
    configured: isGoogleOAuthAvailable(),
  });
}
