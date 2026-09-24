import { NextResponse } from "next/server";
import { completeDigiLockerAuthorization, failDigiLockerAuthorization } from "@/lib/gigxomi/digilocker-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  const error = url.searchParams.get("error")?.trim();
  const returnPath = (query: string) => state.endsWith(".mobile") ? `/mobile/digilocker-return?${query}` : `/freelancer/onboarding?${query}`;
  if (error || !code || !state) {
    if (state) await failDigiLockerAuthorization(state, error || "DigiLocker callback data was incomplete.");
    return NextResponse.redirect(new URL(returnPath(`identity=failed&reason=${encodeURIComponent(error || "missing_callback_data")}`), request.url));
  }
  const result = await completeDigiLockerAuthorization(code, state);
  return NextResponse.redirect(new URL(result.ok ? returnPath("identity=verified") : returnPath(`identity=failed&reason=${encodeURIComponent(result.error)}`), request.url));
}
