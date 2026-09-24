import type { RegistrationPackage } from "@/lib/gigxomi/public-growth-types";
import { isRegistrationPackageFree } from "@/lib/billing/package-billing";

const DEFAULT_AGENCY_SUBSCRIPTION_URL = "https://rzp.io/rzp/9RxcaPs";

function cleanUrl(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^https:\/\//i.test(trimmed) ? trimmed : null;
}

export function getExternalPackageCheckoutUrl(pkg: RegistrationPackage) {
  if (pkg.audience !== "AGENCY" || isRegistrationPackageFree(pkg)) {
    return null;
  }

  return cleanUrl(process.env.AGENCY_SUBSCRIPTION_URL) ?? cleanUrl(process.env.NEXT_PUBLIC_AGENCY_SUBSCRIPTION_URL) ?? DEFAULT_AGENCY_SUBSCRIPTION_URL;
}
