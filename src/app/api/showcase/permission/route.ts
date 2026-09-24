import { featureDisabled } from "@/lib/api/feature-disabled";

export async function POST() {
  return featureDisabled("Legacy showcase-permission endpoint is disabled. Use delivery approval and portfolio review instead.");
}
