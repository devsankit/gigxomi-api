export type PublicShellIcon =
  | "sparkles"
  | "compass"
  | "users"
  | "shield"
  | "badge-check"
  | "clapperboard"
  | "video"
  | "layout-grid"
  | "timer-reset"
  | "wallet"
  | "crown"
  | "mail";

export type PublicSurfaceKey = "matcher" | "services" | "agencies" | "why-agencies";
export type PublicGrowthKey = "freelancers";
export type PublicPresetKey =
  | "best-sellers"
  | "short-form"
  | "long-form"
  | "graphic-design"
  | "fast-delivery"
  | "budget-friendly"
  | "premium-editors";

export type PublicShellNavItem<TId extends string = string> = {
  href: string;
  icon: PublicShellIcon;
  id: TId;
  label: string;
};

export type PublicShellUtilityLink = {
  href: string;
  id:
    | "about"
    | "pricing"
    | "blog"
    | "knowledge-base"
    | "contact";
  label: string;
};

export const PUBLIC_SURFACE_NAV: PublicShellNavItem<PublicSurfaceKey>[] = [
  { href: "/", icon: "sparkles", id: "matcher", label: "Home" },
  { href: "/discover?surface=services", icon: "compass", id: "services", label: "Discover" },
  { href: "/agencies", icon: "users", id: "agencies", label: "Agencies" },
  { href: "/discover?surface=why-agencies", icon: "shield", id: "why-agencies", label: "Why Agencies Join" },
];

export const PUBLIC_GROWTH_NAV: PublicShellNavItem<PublicGrowthKey>[] = [
  { href: "/freelancers", icon: "users", id: "freelancers", label: "For Freelancers" },
];

export const PUBLIC_DISCOVERY_NAV: PublicShellNavItem<PublicPresetKey>[] = [
  { href: "/discover?surface=services&preset=best-sellers", icon: "badge-check", id: "best-sellers", label: "Best Sellers" },
  { href: "/discover?surface=services&preset=short-form", icon: "clapperboard", id: "short-form", label: "Short Form" },
  { href: "/discover?surface=services&preset=long-form", icon: "video", id: "long-form", label: "Long Form" },
  { href: "/discover?surface=services&preset=graphic-design", icon: "layout-grid", id: "graphic-design", label: "Design" },
  { href: "/discover?surface=services&preset=premium-editors", icon: "crown", id: "premium-editors", label: "Premium" },
];

export const PUBLIC_INFO_NAV: PublicShellUtilityLink[] = [
  { href: "/about", id: "about", label: "About" },
  { href: "/pricing", id: "pricing", label: "Pricing" },
  { href: "/blog", id: "blog", label: "Blog" },
  { href: "/knowledge-base", id: "knowledge-base", label: "Knowledge Base" },
  { href: "/contact", id: "contact", label: "Contact" },
];

export function normalizePublicSurfaceParam(value?: string): PublicSurfaceKey {
  if (value === "services" || value === "agencies" || value === "why-agencies") {
    return value;
  }

  return "matcher";
}

export function normalizePublicPresetParam(value?: string): PublicPresetKey {
  if (
    value === "short-form" ||
    value === "long-form" ||
    value === "graphic-design" ||
    value === "fast-delivery" ||
    value === "budget-friendly" ||
    value === "premium-editors"
  ) {
    return value;
  }

  return "best-sellers";
}

export function getPublicSurfaceTitle(surface: PublicSurfaceKey) {
  if (surface === "matcher") return "Freelancer Matcher";
  if (surface === "agencies") return "Agencies";
  if (surface === "why-agencies") return "Why Agencies Join";
  return "Discover Services";
}
