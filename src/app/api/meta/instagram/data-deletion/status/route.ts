import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";

  return NextResponse.json(
    {
      ok: true,
      status: "received",
      confirmationCode: code,
      message: "Gigxomi has received the Instagram data deletion request for this confirmation code.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
