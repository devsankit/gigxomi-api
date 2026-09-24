import type { RegistrationPackage, RegistrationPackageAudience } from "@/lib/gigxomi/public-growth-types";

const PREFERRED_SLUGS: Record<RegistrationPackageAudience, string[]> = {
  FREELANCER: ["freelancer-pro", "freelancer", "freelancer-starter"],
  AGENCY: ["agency-freemium", "agency-premium", "agency-launch", "agency", "agency-scale"],
};

const LAUNCH_COPY: Record<RegistrationPackageAudience, Pick<RegistrationPackage, "name" | "shortSubtitle" | "description" | "featureBullets" | "compareHighlights">> = {
  FREELANCER: {
    name: "Freelancer",
    shortSubtitle: "₹0 forever — no subscription fee",
    description: "Build your editor business with a public portfolio, service marketplace, agency opportunities, delivery tools, and payouts at no subscription cost.",
    featureBullets: [
      "Free public editor profile and portfolio",
      "Publish services in Gigxomi marketplace",
      "Receive agency offers and apply for projects",
      "Manage chat, delivery, and revisions",
      "Track leads, earnings, wallet, and payouts",
      "Use analytics, profile boost, and verification tools",
    ],
    compareHighlights: ["₹0 forever", "Public portfolio", "Service marketplace", "Agency opportunities", "Delivery workflow", "Wallet & payouts"],
  },
  AGENCY: {
    name: "Agency",
    shortSubtitle: "₹12,000/year — one complete agency workspace",
    description: "Run leads, editor sourcing, projects, approvals, clients, managers, finance, automation, and analytics for the equivalent of ₹1,000 per month, billed annually.",
    featureBullets: [
      "Lead CRM, clients, managers, and agency dashboard",
      "Find editors, send offers, and manage your Team",
      "Route projects, review delivery, and collect approvals",
      "Manage invoices, collections, wallet, and accounting",
      "Use AI tools, automations, analytics, and integrations",
      "Customize branding with API, webhooks, and priority support",
    ],
    compareHighlights: ["₹1,000/month equivalent", "Lead CRM", "Editor Team", "Client approvals", "Finance & analytics", "Branding & integrations"],
  },
};

function selectForAudience(packages: RegistrationPackage[], audience: RegistrationPackageAudience) {
  const candidates = packages
    .filter((pkg) => pkg.audience === audience)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const preferred = PREFERRED_SLUGS[audience]
    .map((slug) => candidates.find((pkg) => pkg.slug === slug))
    .find(Boolean);
  const selected = preferred ?? candidates.find((pkg) => pkg.isRecommended) ?? candidates[0];
  if (!selected) return null;

  return {
    ...selected,
    ...LAUNCH_COPY[audience],
    badgeText: audience === "AGENCY" ? "Best for agencies" : "Free for freelancers",
    showBadge: true,
  } satisfies RegistrationPackage;
}

export function selectLaunchRegistrationPackages(packages: RegistrationPackage[]) {
  const selected: RegistrationPackage[] = [];
  const freelancer = selectForAudience(packages, "FREELANCER");
  if (freelancer) selected.push(freelancer);
  selected.push(
    ...packages
      .filter((pkg) => pkg.audience === "AGENCY")
      .sort((left, right) => left.sortOrder - right.sortOrder),
  );
  return selected;
}
