import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const MOBILE_STALE_SESSION_CODE = "SESSION_STALE";

export function createStaleMobileSessionResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: MOBILE_STALE_SESSION_CODE,
      error: "This saved session no longer matches an active Gigxomi account. Sign in or register again.",
      actions: ["SIGN_IN", "REGISTER"],
    },
    { status: 401 },
  );
}

export async function rejectMissingMobileSessionUser(userId: string) {
  try {
    const user = await prisma.appAuthUser.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    return user ? null : createStaleMobileSessionResponse();
  } catch (error) {
    console.error("[mobile-session-user] Warning: could not query appAuthUser for session:", error);
    // On transient DB disconnect/timeout, allow valid JWT session to proceed
    return null;
  }
}

export function isMissingMobileSessionUserError(error: unknown) {
  return error instanceof Error && error.message.trim().toLowerCase() === "user not found.";
}
