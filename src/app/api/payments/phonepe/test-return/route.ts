import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { PhonePeHttpClient, PhonePeRequestError, readPhonePeState } from "@/lib/billing/phonepe-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

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

function classifyPhonePeState(state: string) {
  const normalized = state.toUpperCase();
  if (["COMPLETED", "SUCCESS", "PAYMENT_SUCCESS"].includes(normalized)) {
    return "success";
  }
  if (["FAILED", "CANCELLED", "EXPIRED", "PAYMENT_ERROR", "PAYMENT_FAILED", "TXN_FAILED", "TRANSACTION_FAILED"].includes(normalized)) {
    return "failed";
  }
  return "pending";
}

function readFirstParam(params: URLSearchParams, keys: string[]) {
  for (const key of keys) {
    const value = params.get(key)?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function getStatusLookupIds(params: URLSearchParams) {
  return Array.from(
    new Set(
      [
        readFirstParam(params, ["merchantOrderId"]),
        readFirstParam(params, ["merchantTransactionId"]),
        readFirstParam(params, ["orderId"]),
        readFirstParam(params, ["transactionId"]),
        readFirstParam(params, ["providerReference"]),
      ].filter(Boolean),
    ),
  );
}

function getProviderReturnState(params: URLSearchParams) {
  return readFirstParam(params, ["state", "code", "status", "paymentStatus", "transactionStatus"]);
}

function getProviderReturnMessage(params: URLSearchParams) {
  return readFirstParam(params, ["message", "error", "errorMessage", "responseMessage", "reason"]).slice(0, 180);
}

function getSafeStatusError(error: unknown) {
  if (error instanceof PhonePeRequestError) {
    const providerCode = typeof error.payload.code === "string" ? error.payload.code : "";
    const providerMessage =
      typeof error.payload.message === "string"
        ? error.payload.message
        : typeof error.payload.error === "string"
          ? error.payload.error
          : "";
    return [String(error.status), providerCode, providerMessage].filter(Boolean).join(" | ").slice(0, 180);
  }

  return error instanceof Error ? error.message.slice(0, 180) : "Unknown status error";
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN"]);
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  const lookupIds = getStatusLookupIds(url.searchParams);
  const merchantOrderId = lookupIds[0] ?? "";
  const providerReturnState = getProviderReturnState(url.searchParams);
  const providerReturnMessage = getProviderReturnMessage(url.searchParams);

  if (!merchantOrderId) {
    return redirectToPricing(request, {
      phonepeTestStatus: "error",
      phonepeTestMessage: providerReturnMessage || "PhonePe test payment reference was missing.",
      phonepeTestState: providerReturnState,
    });
  }

  let lastStatusError = "";
  try {
    const client = new PhonePeHttpClient();
    for (const delay of [0, 700, 1700, 3200]) {
      if (delay > 0) {
        await sleep(delay);
      }

      for (const lookupId of lookupIds) {
        try {
          const raw = await client.request(`/checkout/v2/order/${encodeURIComponent(lookupId)}/status?details=false&errorContext=true`, {
            method: "GET",
          });
          const state = readPhonePeState(raw);

          return redirectToPricing(request, {
            phonepeTestStatus: classifyPhonePeState(state),
            phonepeTestState: state,
            merchantOrderId: lookupId,
          });
        } catch (error) {
          lastStatusError = getSafeStatusError(error);
        }
      }
    }
  } catch (error) {
    lastStatusError = getSafeStatusError(error);
  }

  if (providerReturnState) {
    return redirectToPricing(request, {
      phonepeTestStatus: classifyPhonePeState(providerReturnState),
      phonepeTestState: providerReturnState,
      phonepeTestMessage: providerReturnMessage || "PhonePe returned before the status API confirmed the order.",
      merchantOrderId,
    });
  }

  if (lastStatusError) {
    console.error("[phonepe-test] Status check failed", {
      merchantOrderId,
      lookupIds,
      error: lastStatusError,
    });
  }

  return redirectToPricing(request, {
    phonepeTestStatus: "pending",
    phonepeTestMessage: lastStatusError
      ? `PhonePe returned before payment confirmation. Last status check: ${lastStatusError}.`
      : "PhonePe returned before payment confirmation. Retry once, or refresh this status after a few seconds.",
    merchantOrderId,
  });
}
