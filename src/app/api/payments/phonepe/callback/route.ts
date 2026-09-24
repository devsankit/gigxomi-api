import { featureDisabled } from "@/lib/api/feature-disabled";

export async function POST() {
  return featureDisabled("PhonePe callback handling is disabled in staging until the real payment flow is approved.");
}
