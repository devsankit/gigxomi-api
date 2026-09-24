import type { RegistrationPackage, RegistrationPackageAudience } from "@/lib/gigxomi/public-growth-types";

export function findPreferredRegistrationPackage(packages: RegistrationPackage[], audience: RegistrationPackageAudience) {
  const audiencePackages = packages
    .filter((pkg) => pkg.audience === audience || pkg.packageType === audience || pkg.packageType === "BOTH")
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);

  if (audience === "FREELANCER") {
    return audiencePackages.find((pkg) => `${pkg.slug ?? ""} ${pkg.name}`.toLowerCase().includes("starter"))
      ?? audiencePackages.find((pkg) => pkg.isFree || pkg.amount === 0)
      ?? audiencePackages[0]
      ?? null;
  }

  return audiencePackages.find((pkg) => pkg.isRecommended) ?? audiencePackages[0] ?? null;
}

export function buildRegistrationPackageHref(pkg: RegistrationPackage | null, audience: RegistrationPackageAudience) {
  return pkg?.id ? `/signup?packageId=${encodeURIComponent(pkg.id)}` : `/signup?role=${audience === "AGENCY" ? "agency" : "freelancer"}`;
}
