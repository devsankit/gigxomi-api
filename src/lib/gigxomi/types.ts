export type WordPressServiceResponse = {
  count: number;
  items: WordPressService[];
};

export type WordPressService = {
  service_id: number;
  service_title: string;
  service_slug: string;
  service_url: string;
  featured_image: string;
  category: string | string[];
  video_url: string;
  gallery: Record<string, string> | string[];
  delivery_time: string;
  price_type: string;
  price: number | null;
  currency: string;
  price_packages: Array<Record<string, unknown>>;
  description: string;
  addons: string[];
  faq: Array<{ question?: string; answer?: string }>;
  freelancer: {
    freelancer_post_id: number;
    user_id: number;
    username: string;
    display_name: string;
    first_name: string;
    last_name: string;
    full_name: string;
    title: string;
    category: string | string[];
    featured_image: string;
    english_level: string;
    freelancer_type: string;
    description: string;
    education: string[];
    experience: string[];
    skills: string[];
    faq: Array<{ question?: string; answer?: string }>;
  };
};

export type DiscoveryPreset =
  | "best-sellers"
  | "short-form"
  | "long-form"
  | "graphic-design"
  | "fast-delivery"
  | "budget-friendly"
  | "premium-editors";

export type MediaTypeFilter = "all" | "video" | "image";

export type SortOption = "relevance" | "price-low" | "delivery-fast";

export type MatchFilters = {
  budget?: number;
  urgency?: string;
  category?: string;
  mediaType?: MediaTypeFilter;
  discoveryPreset?: DiscoveryPreset;
  sort?: SortOption;
};

export type MatchReason = {
  label: string;
  detail: string;
};

export type MatchedService = WordPressService & {
  score: number;
  reasons: MatchReason[];
  whatsappHref: string;
  normalizedCategory: string;
  summary: string;
};

export type MatchResponse = {
  prompt: string;
  extracted: {
    budget?: number;
    urgency?: string;
    keywords: string[];
    categories: string[];
  };
  appliedFilters: {
    category?: string;
    mediaType?: MediaTypeFilter;
    discoveryPreset?: DiscoveryPreset;
    sort?: SortOption;
    budgetMode: "not-set" | "within-budget" | "closest-above-budget";
  };
  results: MatchedService[];
};
