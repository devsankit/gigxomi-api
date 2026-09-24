import { PhonePeRequestError } from "@/lib/billing/phonepe-client";

export const PHONEPE_CHECKOUT_ERROR_CODES = [
  "autopay-disabled",
  "phonepe-oauth",
  "merchant-not-enabled",
  "invalid-request",
  "provider-timeout",
  "provider-unavailable",
  "payment-pending",
  "invalid-coupon",
  "invalid-vpa",
  "package-changed",
  "session-expired",
  "checkout-failed",
] as const;

export type PhonePeCheckoutErrorCode = (typeof PHONEPE_CHECKOUT_ERROR_CODES)[number];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to start PhonePe AutoPay.";
}

export function classifyPhonePeCheckoutError(error: unknown): PhonePeCheckoutErrorCode {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("confirmation is pending") || message.includes("already active")) return "payment-pending";
  if (message.includes("package changed")) return "package-changed";
  if (message.includes("user not found") || message.includes("agency account required")) return "session-expired";

  if (message.includes("coupon")) return "invalid-coupon";
  if (message.includes("valid upi") || message.includes("upi id")) return "invalid-vpa";
  if (message.includes("is disabled") || message.includes("payments are disabled") || message.includes("plugin switch is off") || message.includes("env keys missing") || message.includes("not fully configured")) {
    return "autopay-disabled";
  }
  if (error instanceof PhonePeRequestError && error.path.includes("oauth") && [400, 401, 403].includes(error.status)) return "phonepe-oauth";
  if (message.includes("access token")) return "phonepe-oauth";
  if (error instanceof PhonePeRequestError) {
    if (error.status === 401) return "phonepe-oauth";
    if (error.status === 403) return "merchant-not-enabled";
    if (error.status === 408 || error.status === 429 || message.includes("timeout") || message.includes("timed out")) return "provider-timeout";
    if (error.status >= 500) return "provider-unavailable";
    if (error.status === 400 || error.status === 422) return "invalid-request";
  }
  if ((error instanceof Error && error.name === "TimeoutError") || message.includes("timeout") || message.includes("aborted") || message.includes("network") || message.includes("fetch failed")) return "provider-timeout";
  if (message.includes("phonepe") || message.includes("provider") || message.includes("redirect url")) return "provider-unavailable";
  return "checkout-failed";
}

export function phonePeCheckoutErrorView(code: string | null | undefined) {
  const views: Record<PhonePeCheckoutErrorCode, { title: string; copy: string; retry: boolean }> = {
    "autopay-disabled": {
      title: "AutoPay is not enabled yet",
      copy: "AutoPay is unavailable in Billing Control. If enabled below, you can pay once through PhonePe without automatic renewal, or return to Agency Freemium.",
      retry: false,
    },
    "phonepe-oauth": {
      title: "PhonePe could not authorize this merchant",
      copy: "We couldn't connect securely to PhonePe. Please contact support or try again later. If you already tried paying, refresh payment status before starting another checkout.",
      retry: true,
    },
    "merchant-not-enabled": {
      title: "PhonePe has not enabled this payment method",
      copy: "PhonePe rejected this payment method for our merchant account. If another method is available below, you can choose it. Otherwise, return to Agency Freemium.",
      retry: false,
    },
    "invalid-request": {
      title: "PhonePe could not read this request",
      copy: "PhonePe rejected the payment details. Review your payment method and try again.",
      retry: true,
    },
    "provider-timeout": {
      title: "PhonePe took too long to respond",
      copy: "We haven't received a final payment status yet. Refresh payment status before trying again. If your bank shows a debit, don't make another payment.",
      retry: true,
    },
    "provider-unavailable": {
      title: "PhonePe is temporarily unavailable",
      copy: "We couldn't confirm the gateway response. Refresh payment status before retrying. Premium will activate only after verified payment confirmation.",
      retry: true,
    },
    "payment-pending": {
      title: "Payment confirmation is pending",
      copy: "Your existing payment must be checked before starting another. Refresh payment status. Premium activates only after PhonePe confirms the payment.",
      retry: false,
    },
    "invalid-coupon": {
      title: "This coupon could not be applied",
      copy: "Check the coupon code, validity, and eligible package, then try again. Your plan has not changed.",
      retry: true,
    },
    "invalid-vpa": {
      title: "Enter a valid UPI ID",
      copy: "Use a UPI ID such as name@bank, or switch to PhonePe / UPI app.",
      retry: true,
    },
    "package-changed": {
      title: "This package changed",
      copy: "Return to plans to review the latest price and benefits before paying.",
      retry: false,
    },
    "session-expired": {
      title: "Your checkout session expired",
      copy: "Sign in again and choose your Agency plan. If you already tried paying, refresh your plan status before making another payment.",
      retry: false,
    },
    "checkout-failed": {
      title: "Let's check your payment",
      copy: "We couldn't finish this checkout. Refresh payment status first, then retry if no payment is pending.",
      retry: true,
    },
  };
  return code && Object.hasOwn(views, code) ? views[code as PhonePeCheckoutErrorCode] : null;
}

export function phonePeMobileError(code: PhonePeCheckoutErrorCode) {
  const view = phonePeCheckoutErrorView(code)!;
  const status = code === "invalid-coupon" ? 422 : code === "invalid-vpa" || code === "invalid-request" ? 400 : code === "session-expired" ? 401 : code === "autopay-disabled" || code === "merchant-not-enabled" || code === "phonepe-oauth" || code === "provider-timeout" || code === "provider-unavailable" ? 503 : 409;
  return {
    code: `PHONEPE_${code.replaceAll("-", "_").toUpperCase()}`,
    error: view.copy,
    actions: code === "payment-pending" ? ["REFRESH_PAYMENT_STATUS", "CHOOSE_FREEMIUM"] : code === "session-expired" ? ["SIGN_IN"] : view.retry ? ["RETRY", "CHOOSE_FREEMIUM"] : ["CHOOSE_FREEMIUM"],
    retryable: view.retry,
    status,
  };
}
