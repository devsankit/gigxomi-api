import type { PackageBillingInterval, PackageBillingType, RegistrationPackage } from "@/lib/gigxomi/public-growth-types";

export type RegistrationBillingCycle = "MONTHLY" | "YEARLY";

function normalizeBillingType(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function hasExplicitZeroAmount(pkg: RegistrationPackage) {
  return typeof pkg.amount === "number" && Number.isFinite(pkg.amount) && pkg.amount <= 0;
}

function hasFreePriceLabel(pkg: RegistrationPackage) {
  return /\bfree\b|(?:^|\s)(?:inr|rs\.?|₹)?\s*0(?:\.00)?(?:\s|$)/i.test(pkg.priceLabel ?? "");
}

export function isRegistrationPackageFree(pkg: RegistrationPackage) {
  const billingType = normalizeBillingType(pkg.billingType);
  return pkg.isFree === true || pkg.paymentRequired === false || billingType === "FREE" || hasExplicitZeroAmount(pkg) || hasFreePriceLabel(pkg);
}

export function getRegistrationPackageBillingType(pkg: RegistrationPackage): PackageBillingType {
  if (isRegistrationPackageFree(pkg)) {
    return "FREE";
  }
  return normalizeBillingType(pkg.billingType) === "ONE_TIME_PAID" ? "ONE_TIME_PAID" : "RECURRING";
}

function positivePrice(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveRegistrationBillingSelection(pkg: RegistrationPackage, requestedCycle?: RegistrationBillingCycle | null) {
  const billingType = getRegistrationPackageBillingType(pkg);
  if (billingType === "FREE") {
    return { billingCycle: null, billingInterval: "CUSTOM" as PackageBillingInterval, amount: 0, durationDays: pkg.durationDays };
  }
  if (billingType === "ONE_TIME_PAID") {
    return {
      billingCycle: null,
      billingInterval: "ONE_TIME" as PackageBillingInterval,
      amount: positivePrice(pkg.priceOneTime) ?? positivePrice(pkg.amount) ?? 0,
      durationDays: pkg.durationDays,
    };
  }

  const billingCycle: RegistrationBillingCycle = requestedCycle ?? (pkg.billingInterval === "YEARLY" ? "YEARLY" : "MONTHLY");
  const amount = billingCycle === "YEARLY"
    ? positivePrice(pkg.priceYearly)
    : positivePrice(pkg.priceMonthly) ?? positivePrice(pkg.amount);
  if (amount === null) return null;
  return {
    billingCycle,
    billingInterval: billingCycle as PackageBillingInterval,
    amount,
    durationDays: billingCycle === "YEARLY" ? 365 : 30,
  };
}
