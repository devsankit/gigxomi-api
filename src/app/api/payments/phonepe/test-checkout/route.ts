import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { PhonePeHttpClient, readPhonePeRedirectUrl } from "@/lib/billing/phonepe-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const TEST_AMOUNT_RUPEES = 50;

function getRequestOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (host) {
    const proto = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

function buildMerchantOrderId() {
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `GXTEST${Date.now()}${randomPart}`;
}

function redirectToPricing(request: Request, params: Record<string, string>) {
  const url = new URL("/pricing", getRequestOrigin(request));
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const origin = getRequestOrigin(request);
  const merchantOrderId = buildMerchantOrderId();
  const redirectUrl = new URL("/api/payments/phonepe/test-return", origin);
  redirectUrl.searchParams.set("merchantOrderId", merchantOrderId);

  try {
    const payload = {
      merchantOrderId,
      amount: TEST_AMOUNT_RUPEES * 100,
      expireAfter: 1200,
      metaInfo: {
        udf1: "gigxomi-pricing-test",
        udf2: "no-registration",
        udf3: "dummy-50-rupees",
        udf4: "pricing-page",
        udf5: "phonepe-gateway-test",
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "Gigxomi PhonePe test package",
        merchantUrls: {
          redirectUrl: redirectUrl.toString(),
        },
      },
    };

    const raw = await new PhonePeHttpClient().request("/checkout/v2/pay", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const phonePeRedirectUrl = readPhonePeRedirectUrl(raw);

    if (!phonePeRedirectUrl) {
      return redirectToPricing(request, {
        phonepeTestStatus: "error",
        phonepeTestMessage: "PhonePe did not return a checkout URL.",
        merchantOrderId,
      });
    }

    return NextResponse.redirect(phonePeRedirectUrl, { status: 303 });
  } catch (error) {
    console.error("[phonepe-test] Checkout start failed", {
      merchantOrderId,
      error: error instanceof Error ? error.message : "Unknown PhonePe test checkout error",
    });
    return redirectToPricing(request, {
      phonepeTestStatus: "error",
      phonepeTestMessage: "PhonePe test checkout could not start. Review the secure server logs and payment-provider configuration.",
      merchantOrderId,
    });
  }
}
