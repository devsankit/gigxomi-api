import "server-only";

import type { RegistrationPackage } from "@/lib/gigxomi/public-growth-types";

export type ProviderInitiateInput = {
  userId: string;
  userName: string;
  phone: string;
  email: string | null;
  package: RegistrationPackage;
  subscriptionId: string;
  merchantOrderId: string;
  merchantTransactionId?: string;
  amount: number;
  maxAmount?: number;
  currency: string;
};

export type ProviderStatusResult = {
  ok: boolean;
  state: string;
  providerReference?: string | null;
  raw: unknown;
};

export type ProviderRedirectResult = {
  redirectUrl: string;
  providerReference?: string | null;
  raw: unknown;
};

export interface PhonePeOneTimePaymentProvider {
  initiate(input: ProviderInitiateInput): Promise<ProviderRedirectResult>;
  getStatus(merchantTransactionId: string): Promise<ProviderStatusResult>;
}

export interface PhonePeAutopayProvider {
  setup(input: ProviderInitiateInput & {
    merchantSubscriptionId: string;
    validAfter?: Date | null;
    expiresAt?: Date | null;
    paymentMode?: "UPI_INTENT" | "UPI_COLLECT";
    upiVpa?: string | null;
  }): Promise<ProviderRedirectResult>;
  getSetupStatus(merchantOrderId: string): Promise<ProviderStatusResult>;
  getSubscriptionStatus(merchantSubscriptionId: string): Promise<ProviderStatusResult>;
  notifyRedemption(input: { merchantSubscriptionId: string; merchantOrderId: string; amount: number; currency: string; subscriptionId: string }): Promise<ProviderStatusResult>;
  executeRedemption(input: { merchantSubscriptionId: string; merchantOrderId: string; amount: number; currency: string; subscriptionId: string }): Promise<ProviderStatusResult>;
  getRedemptionStatus(merchantOrderId: string): Promise<ProviderStatusResult>;
  cancel(merchantSubscriptionId: string): Promise<ProviderStatusResult>;
  pause(input: { merchantSubscriptionId: string; pauseStartDate?: Date | null; pauseEndDate?: Date | null }): Promise<ProviderStatusResult>;
  unpause(merchantSubscriptionId: string): Promise<ProviderStatusResult>;
}
