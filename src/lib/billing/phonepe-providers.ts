import "server-only";

import { buildPhonePeUrls } from "@/lib/billing/phonepe-config";
import { PhonePeHttpClient, readPhonePeRedirectUrl, readPhonePeReference, readPhonePeState } from "@/lib/billing/phonepe-client";
import type { PhonePeAutopayProvider, PhonePeOneTimePaymentProvider, ProviderInitiateInput, ProviderRedirectResult, ProviderStatusResult } from "@/lib/billing/payment-provider";

function toMinorUnits(amount: number) {
  return Math.round(amount * 100);
}

function parseStatus(payload: unknown): ProviderStatusResult {
  const state = readPhonePeState(payload);
  return {
    ok: ["COMPLETED", "SUCCESS", "ACTIVE", "AUTHORIZATION_SUCCESSFUL", "NOTIFIED", "EXECUTED"].includes(state.toUpperCase()),
    state,
    providerReference: readPhonePeReference(payload),
    raw: payload,
  };
}

export class PhonePeStandardCheckoutProvider implements PhonePeOneTimePaymentProvider {
  private readonly client = new PhonePeHttpClient();

  async initiate(input: ProviderInitiateInput): Promise<ProviderRedirectResult> {
    const urls = buildPhonePeUrls();
    const merchantOrderId = input.merchantOrderId;
    const payload = {
      merchantOrderId,
      amount: toMinorUnits(input.amount),
      expireAfter: 1200,
      metaInfo: {
        udf1: input.userId,
        udf2: input.subscriptionId,
        udf3: input.package.id,
        udf4: input.phone,
        udf5: input.package.billingInterval ?? "",
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: `Gigxomi ${input.package.name}`.slice(0, 80),
        merchantUrls: {
          redirectUrl: `${urls.paymentReturnUrl}?merchantOrderId=${encodeURIComponent(merchantOrderId)}&merchantTransactionId=${encodeURIComponent(input.merchantTransactionId ?? merchantOrderId)}`,
        },
      },
    };

    const raw = await this.client.request("/checkout/v2/pay", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const redirectUrl = readPhonePeRedirectUrl(raw);
    if (!redirectUrl) {
      throw new Error("PhonePe did not return a checkout redirect URL.");
    }
    return { redirectUrl, providerReference: readPhonePeReference(raw), raw };
  }

  async getStatus(merchantTransactionId: string): Promise<ProviderStatusResult> {
    const raw = await this.client.request(`/checkout/v2/order/${encodeURIComponent(merchantTransactionId)}/status`, { method: "GET" });
    return parseStatus(raw);
  }
}

export class PhonePeMandateAutopayProvider implements PhonePeAutopayProvider {
  private readonly client = new PhonePeHttpClient();

  async setup(input: ProviderInitiateInput & {
    merchantSubscriptionId: string;
    validAfter?: Date | null;
    expiresAt?: Date | null;
    paymentMode?: "UPI_INTENT" | "UPI_COLLECT";
    upiVpa?: string | null;
  }): Promise<ProviderRedirectResult> {
    const paymentMode = input.paymentMode ?? "UPI_INTENT";
    if (paymentMode === "UPI_COLLECT" && !input.upiVpa?.trim()) {
      throw new Error("Enter a valid UPI ID to authorize AutoPay.");
    }
    const setupExpireAt = Date.now() + 20 * 60 * 1000;
    const mandateExpireAt = input.expiresAt?.getTime() ?? Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    const payload = {
      merchantOrderId: input.merchantOrderId,
      amount: toMinorUnits(input.amount),
      expireAt: setupExpireAt,
      metaInfo: {
        udf1: input.userId,
        udf2: input.subscriptionId,
        udf3: input.package.id,
        udf4: input.phone,
        udf5: input.package.billingInterval ?? "",
      },
      paymentFlow: {
        type: "SUBSCRIPTION_SETUP",
        merchantSubscriptionId: input.merchantSubscriptionId,
        authWorkflowType: "TRANSACTION",
        amountType: "FIXED",
        maxAmount: toMinorUnits(Math.max(input.amount, input.maxAmount ?? input.package.amount ?? input.amount)),
        frequency: "ON_DEMAND",
        expireAt: mandateExpireAt,
        paymentMode:
          paymentMode === "UPI_COLLECT"
            ? { type: "UPI_COLLECT", details: { type: "VPA", vpa: input.upiVpa?.trim() } }
            : { type: "UPI_INTENT", targetApp: "com.phonepe.app" },
      },
      deviceContext: { deviceOS: "ANDROID" },
    };

    const raw = await this.client.request("/subscriptions/v2/setup", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const redirectUrl = readPhonePeRedirectUrl(raw);
    if (!redirectUrl && !(paymentMode === "UPI_COLLECT" && readPhonePeReference(raw))) {
      throw new Error("PhonePe did not return an Autopay setup redirect URL.");
    }
    return { redirectUrl, providerReference: readPhonePeReference(raw), raw };
  }

  async getSetupStatus(merchantOrderId: string): Promise<ProviderStatusResult> {
    const raw = await this.client.request(`/subscriptions/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=true`, { method: "GET" });
    return parseStatus(raw);
  }

  async getSubscriptionStatus(merchantSubscriptionId: string): Promise<ProviderStatusResult> {
    const raw = await this.client.request(`/subscriptions/v2/${encodeURIComponent(merchantSubscriptionId)}/status?details=true`, { method: "GET" });
    return parseStatus(raw);
  }

  async notifyRedemption(input: { merchantSubscriptionId: string; merchantOrderId: string; amount: number; currency: string; subscriptionId: string }): Promise<ProviderStatusResult> {
    const raw = await this.client.request("/subscriptions/v2/notify", {
      method: "POST",
      body: JSON.stringify({
        merchantOrderId: input.merchantOrderId,
        amount: toMinorUnits(input.amount),
        expireAt: Date.now() + 48 * 60 * 60 * 1000,
        metaInfo: { udf1: input.subscriptionId },
        paymentFlow: {
          type: "SUBSCRIPTION_REDEMPTION",
          merchantSubscriptionId: input.merchantSubscriptionId,
          redemptionRetryStrategy: "STANDARD",
          autoDebit: true,
        },
      }),
    });
    return parseStatus(raw);
  }

  async executeRedemption(input: { merchantSubscriptionId: string; merchantOrderId: string; amount: number; currency: string; subscriptionId: string }): Promise<ProviderStatusResult> {
    const raw = await this.client.request("/subscriptions/v2/redeem", {
      method: "POST",
      body: JSON.stringify({ merchantOrderId: input.merchantOrderId }),
    });
    return parseStatus(raw);
  }

  async getRedemptionStatus(merchantOrderId: string): Promise<ProviderStatusResult> {
    const raw = await this.client.request(`/subscriptions/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=true`, { method: "GET" });
    return parseStatus(raw);
  }

  async cancel(merchantSubscriptionId: string): Promise<ProviderStatusResult> {
    const raw = await this.client.request(`/subscriptions/v2/${encodeURIComponent(merchantSubscriptionId)}/cancel`, { method: "POST", body: JSON.stringify({}) });
    return parseStatus(raw);
  }

  async pause(input: { merchantSubscriptionId: string; pauseStartDate?: Date | null; pauseEndDate?: Date | null }): Promise<ProviderStatusResult> {
    const raw = await this.client.request(`/subscriptions/v2/${encodeURIComponent(input.merchantSubscriptionId)}/pause`, {
      method: "POST",
      body: JSON.stringify({
        pauseStartDate: input.pauseStartDate?.toISOString(),
        pauseEndDate: input.pauseEndDate?.toISOString(),
      }),
    });
    return parseStatus(raw);
  }

  async unpause(merchantSubscriptionId: string): Promise<ProviderStatusResult> {
    const raw = await this.client.request(`/subscriptions/v2/${encodeURIComponent(merchantSubscriptionId)}/unpause`, { method: "POST", body: JSON.stringify({}) });
    return parseStatus(raw);
  }
}
