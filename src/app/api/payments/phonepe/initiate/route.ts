import { featureDisabled } from "@/lib/api/feature-disabled";

export async function POST() {
  return featureDisabled("PhonePe checkout is inactive for the current launch flow. Use Manual UPI billing instead.");
}
