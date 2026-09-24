import { featureDisabled } from "@/lib/api/feature-disabled";

export async function POST() {
  return featureDisabled("Legacy delivery-link endpoint is disabled. Use persisted delivery assets and share-link refresh instead.");
}
