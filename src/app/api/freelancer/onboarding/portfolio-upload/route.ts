import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";

const allowedTypes = new Map([["video/mp4", "mp4"], ["video/quicktime", "mov"], ["video/webm", "webm"]]);

function isExpectedVideo(buffer: Buffer, mimeType: string) {
  if (mimeType === "video/webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "FREELANCER"]);
  if (!authorization.ok) return authorization.response;
  const form = await request.formData();
  const file = form.get("portfolio");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose a portfolio video." }, { status: 400 });
  const extension = allowedTypes.get(file.type);
  if (!extension) return NextResponse.json({ ok: false, error: "Use an MP4, MOV or WebM portfolio video." }, { status: 415 });
  if (file.size <= 0 || file.size > 100 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Portfolio video must be smaller than 100 MB." }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isExpectedVideo(buffer, file.type)) return NextResponse.json({ ok: false, error: "The uploaded file is not a valid playable video." }, { status: 415 });
  const directory = path.join(process.cwd(), "public", "uploads", "freelancer-portfolios");
  await mkdir(directory, { recursive: true });
  const fileName = `${authorization.session.userId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}.${extension}`;
  await writeFile(path.join(directory, fileName), buffer);
  return NextResponse.json({ ok: true, portfolioUrl: `/uploads/freelancer-portfolios/${fileName}` });
}
