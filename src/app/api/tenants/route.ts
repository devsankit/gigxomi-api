import { featureDisabled } from "@/lib/api/feature-disabled";

export async function GET() {
  return featureDisabled("Legacy tenant-management endpoint is disabled while tenant operations move to the persisted admin flow.");
}

export async function POST() {
  return featureDisabled("Legacy tenant-management endpoint is disabled while tenant operations move to the persisted admin flow.");
}
