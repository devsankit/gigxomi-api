import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { PhonePeHttpClient, PhonePeRequestError, readPhonePeState } from "@/lib/billing/phonepe-client";
import { syncPhonePeEditorPaymentRequest } from "@/lib/gigxomi/app-payment-request-service";

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

function readFirstParam(params: URLSearchParams, keys: string[]) {
  for (const key of keys) {
    const value = params.get(key)?.trim();
    if (value) return value;
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

function redirectToPayouts(request: Request, params: Record<string, string>) {
  const url = new URL("/admin/payout-requests", getRequestOrigin(request));
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  const assignmentId = url.searchParams.get("assignmentId")?.trim() ?? "";
  const paymentRequestId = url.searchParams.get("paymentRequestId")?.trim() ?? "";
  const lookupIds = getStatusLookupIds(url.searchParams);
  const merchantOrderId = lookupIds[0] ?? "";
  const providerReturnState = readFirstParam(url.searchParams, ["state", "code", "status", "paymentStatus", "transactionStatus"]);
  const providerReturnMessage = readFirstParam(url.searchParams, ["message", "error", "errorMessage", "responseMessage", "reason"]).slice(0, 180);

  if (!paymentRequestId || !merchantOrderId) {
    return redirectToPayouts(request, {
      assignmentId,
      editorPaymentMessage: providerReturnMessage || "PhonePe editor payment reference was missing.",
      editorPaymentRequestId: paymentRequestId,
      editorPaymentStatus: "error",
      merchantOrderId,
    });
  }

  let lastStatusError = "";
  try {
    const client = new PhonePeHttpClient();
    for (const delay of [0, 700, 1700, 3200]) {
      if (delay > 0) await sleep(delay);

      for (const lookupId of lookupIds) {
        try {
          const raw = await client.request(`/checkout/v2/order/${encodeURIComponent(lookupId)}/status?details=false&errorContext=true`, {
            method: "GET",
          });
          const state = readPhonePeState(raw);
          const sync = await syncPhonePeEditorPaymentRequest({
            merchantOrderId: lookupId,
            paymentRequestId,
            raw,
            state,
          });

          return redirectToPayouts(request, {
            assignmentId,
            editorPaymentRequestId: paymentRequestId,
            editorPaymentState: state,
            editorPaymentStatus: sync.ok ? sync.request.gatewayStatus.toLowerCase() : "error",
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
    const sync = await syncPhonePeEditorPaymentRequest({
      merchantOrderId,
      paymentRequestId,
      state: providerReturnState,
    });
    return redirectToPayouts(request, {
      assignmentId,
      editorPaymentMessage: providerReturnMessage || "PhonePe returned before the status API confirmed the order.",
      editorPaymentRequestId: paymentRequestId,
      editorPaymentState: providerReturnState,
      editorPaymentStatus: sync.ok ? sync.request.gatewayStatus.toLowerCase() : "pending",
      merchantOrderId,
    });
  }

  if (lastStatusError) {
    console.error("[phonepe-editor-payment] Status check failed", {
      merchantOrderId,
      lookupIds,
      paymentRequestId,
      error: lastStatusError,
    });
  }

  return redirectToPayouts(request, {
    assignmentId,
    editorPaymentMessage: lastStatusError
      ? `PhonePe returned before payment confirmation. Last status check: ${lastStatusError}.`
      : "PhonePe returned before payment confirmation. Refresh payout requests after a few seconds.",
    editorPaymentRequestId: paymentRequestId,
    editorPaymentStatus: "pending",
    merchantOrderId,
  });
}
