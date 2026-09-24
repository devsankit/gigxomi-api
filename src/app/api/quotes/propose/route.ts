import { featureDisabled } from "@/lib/api/feature-disabled";

export async function POST() {
  return featureDisabled("Legacy quote proposal endpoint is disabled. Use the conversation payment-request flow instead.");
}
