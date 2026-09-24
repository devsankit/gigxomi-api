import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";

const allowedMimes = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/pjpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function detectExtension(buffer: Buffer, mimeType: string): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  return allowedMimes.get(mimeType.toLowerCase()) || null;
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["ADMIN", "SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;
  try {
    const form = await request.formData();
    const file = form.get("logo");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose an agency logo." }, { status: 400 });
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Agency logo must be smaller than 5 MB." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const extension = detectExtension(buffer, file.type);
    if (!extension) return NextResponse.json({ ok: false, error: "Use a JPG, PNG or WebP agency logo." }, { status: 415 });
    const directory = path.join(process.cwd(), "public", "uploads", "agency-logos");
    await mkdir(directory, { recursive: true });
    const fileName = `${authorization.session.userId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}.${extension}`;
    await writeFile(path.join(directory, fileName), buffer);
    return NextResponse.json({ ok: true, logoUrl: `/uploads/agency-logos/${fileName}` });
  } catch (error) {
    console.error("[mobile-onboarding-logo] upload failed", {
      userId: authorization.session.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, code: "AGENCY_LOGO_UPLOAD_UNAVAILABLE", error: "We could not upload the logo right now. Please check the image and retry." },
      { status: 503 },
    );
  }
}
