import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";

const allowedTypes = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

function isExpectedImage(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const form = await request.formData();
  const file = form.get("avatar");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose a profile photo." }, { status: 400 });
  const extension = allowedTypes.get(file.type);
  if (!extension) return NextResponse.json({ ok: false, error: "Use a JPG, PNG or WebP profile photo." }, { status: 415 });
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Profile photo must be smaller than 5 MB." }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isExpectedImage(buffer, file.type)) return NextResponse.json({ ok: false, error: "The uploaded file is not a valid image." }, { status: 415 });
  const directory = path.join(process.cwd(), "public", "uploads", "freelancer-avatars");
  await mkdir(directory, { recursive: true });
  const fileName = `${authorization.session.userId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}.${extension}`;
  await writeFile(path.join(directory, fileName), buffer);
  return NextResponse.json({ ok: true, profileImageUrl: `/uploads/freelancer-avatars/${fileName}` });
}
