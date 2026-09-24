import { featureDisabled } from "@/lib/api/feature-disabled";

export async function POST() {
  return featureDisabled("Legacy assignment endpoint is disabled. Use the conversation assignment route instead.");
}
