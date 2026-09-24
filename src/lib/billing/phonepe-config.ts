import "server-only";

export type PhonePeEnvironment = "sandbox" | "production";

export type PhonePeConfig = {
  clientId: string;
  clientSecret: string;
  clientVersion: string;
  merchantId: string | null;
  saltKey: string | null;
  saltIndex: string | null;
  environment: PhonePeEnvironment;
  webhookUsername: string;
  webhookPassword: string;
  appBaseUrl: string;
};

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function optionalEnv(name: string) {
  return process.env[name]?.trim() || "";
}

export function getAppBaseUrl() {
  return requireEnv("APP_BASE_URL").replace(/\/+$/, "");
}

export function getPhonePeConfig(): PhonePeConfig {
  const environment = process.env.PHONEPE_ENV?.trim().toLowerCase() === "production" ? "production" : "sandbox";
  const clientSecret = optionalEnv("PHONEPE_CLIENT_SECRET") || optionalEnv("PHONEPE_API_KEY");
  if (!clientSecret) {
    throw new Error("PHONEPE_CLIENT_SECRET or PHONEPE_API_KEY is not configured.");
  }

  return {
    clientId: requireEnv("PHONEPE_CLIENT_ID"),
    clientSecret,
    clientVersion: process.env.PHONEPE_CLIENT_VERSION?.trim() || "1",
    merchantId: process.env.PHONEPE_MERCHANT_ID?.trim() || null,
    saltKey: process.env.PHONEPE_SALT_KEY?.trim() || null,
    saltIndex: process.env.PHONEPE_SALT_INDEX?.trim() || null,
    environment,
    webhookUsername: optionalEnv("PHONEPE_WEBHOOK_USERNAME"),
    webhookPassword: optionalEnv("PHONEPE_WEBHOOK_PASSWORD"),
    appBaseUrl: getAppBaseUrl(),
  };
}

export function getPhonePeBaseUrl(environment: PhonePeEnvironment) {
  return environment === "production" ? "https://api.phonepe.com/apis/pg" : "https://api-preprod.phonepe.com/apis/pg-sandbox";
}

export function getPhonePeOAuthUrl(environment: PhonePeEnvironment) {
  return environment === "production"
    ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";
}

export function buildPhonePeUrls() {
  const appBaseUrl = getAppBaseUrl();
  return {
    paymentWebhookUrl: `${appBaseUrl}/api/payments/phonepe/webhook`,
    subscriptionWebhookUrl: `${appBaseUrl}/api/subscriptions/phonepe/webhook`,
    paymentReturnUrl: `${appBaseUrl}/api/payments/phonepe/return`,
    subscriptionReturnUrl: `${appBaseUrl}/api/subscriptions/phonepe/return`,
  };
}
