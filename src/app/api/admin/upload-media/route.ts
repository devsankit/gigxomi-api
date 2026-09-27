import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";

const ALLOWED_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
  ["image/gif", "gif"],
]);

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN"]);
  if (!authorization.ok) return authorization.response;

  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Please select an image file to upload." },
        { status: 400 },
      );
    }

    const extension = ALLOWED_TYPES.get(file.type.toLowerCase());
    if (!extension) {
      return NextResponse.json(
        { ok: false, error: "Unsupported image format. Allowed formats: PNG, JPG, WebP, SVG, GIF." },
        { status: 415 },
      );
    }

    if (file.size <= 0 || file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Image file size must be less than 10 MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadDir = path.join(process.cwd(), "public", "uploads", "agency-media");
    await mkdir(uploadDir, { recursive: true });

    const tenantPrefix = (authorization.session.tenantId || authorization.session.userId)
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(-12);
    const mediaType = (form.get("type") as string) === "cover" ? "cover" : "logo";
    const fileName = `${mediaType}-${tenantPrefix}-${Date.now()}.${extension}`;

    await writeFile(path.join(uploadDir, fileName), buffer);

    const relativeUrl = `/uploads/agency-media/${fileName}`;
    return NextResponse.json({
      ok: true,
      url: relativeUrl,
      fileName,
    });
  } catch (error) {
    console.error("Failed to upload agency media:", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error during media upload." },
      { status: 500 },
    );
  }
}
