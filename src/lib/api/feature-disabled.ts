import { NextResponse } from "next/server";

export function featureDisabled(message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status: 410 },
  );
}
