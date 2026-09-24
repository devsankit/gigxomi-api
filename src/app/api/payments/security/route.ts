import { featureDisabled } from "@/lib/api/feature-disabled";

export async function GET() {
  return featureDisabled("Legacy payment-security endpoint is disabled until the real payment state model is connected.");
}

export async function POST() {
  return featureDisabled("Legacy payment-security endpoint is disabled until the real payment state model is connected.");
}
