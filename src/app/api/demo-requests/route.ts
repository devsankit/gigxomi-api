import { NextResponse } from "next/server";

import { createSalesLeadPoolItem } from "@/lib/gigxomi/sales-store";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

type RateLimitEntry = { count: number; expiresAt: number };
const globalForDemoRequests = globalThis as typeof globalThis & { gigxomiDemoRequestLimits?: Map<string, RateLimitEntry> };
const demoRequestLimits = globalForDemoRequests.gigxomiDemoRequestLimits ?? new Map<string, RateLimitEntry>();
globalForDemoRequests.gigxomiDemoRequestLimits = demoRequestLimits;

function clean(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isRateLimited(key: string) {
  const now = Date.now();
  const current = demoRequestLimits.get(key);
  if (!current || current.expiresAt <= now) {
    demoRequestLimits.set(key, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT_MAX_REQUESTS;
}

export async function POST(request: Request) {
  const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  if (isRateLimited(clientKey)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Please try again in a few minutes." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Please complete the demo form." }, { status: 400 });

  const payload = body as Record<string, unknown>;
  if (clean(payload.website, 200)) return NextResponse.json({ ok: true });

  const name = clean(payload.name, 100);
  const businessName = clean(payload.businessName, 120);
  const email = clean(payload.email, 160).toLowerCase();
  const phone = clean(payload.phone, 30);
  const message = clean(payload.message, 1000);

  if (!name) return NextResponse.json({ ok: false, error: "Please enter your name." }, { status: 400 });
  if (!email && !phone) return NextResponse.json({ ok: false, error: "Please add an email or WhatsApp number." }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });

  try {
    await createSalesLeadPoolItem({
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      source: "Gigxomi Website - Get Demo",
      segment: "DEMO_REQUEST",
      serviceInterest: "Gigxomi platform demo",
      priority: "HIGH",
      notes: [
        businessName ? `Business: ${businessName}` : "",
        message || "Requested a Gigxomi platform demo from the homepage.",
      ].filter(Boolean).join("\n"),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Demo request submission failed", error);
    return NextResponse.json({ ok: false, error: "We could not save your request right now. Please try again." }, { status: 500 });
  }
}
