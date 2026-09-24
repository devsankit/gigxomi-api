"use client";

import { pushGrowthEvent } from "@/lib/gigxomi/public-growth-client";

/**
 * PII sanitize guardrail:
 * Explicitly disallow personal data (names, emails, phone numbers, client/project details)
 * from ever being passed into analytics payloads.
 */
const FORBIDDEN_PII_KEYS = new Set([
  "name",
  "fullname",
  "first_name",
  "last_name",
  "display_name",
  "email",
  "phone",
  "mobile",
  "whatsapp_number",
  "message",
  "message_content",
  "notes",
  "project_name",
  "client_name",
  "client_phone",
  "password",
]);

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase().replace(/[-_]/g, "");
    if (FORBIDDEN_PII_KEYS.has(lower)) {
      continue;
    }
    if (value !== undefined && value !== null) {
      safe[key] = value;
    }
  }
  return safe;
}

export type CtaLocation =
  | "header"
  | "hero"
  | "section"
  | "card"
  | "drawer"
  | "modal"
  | "footer"
  | "banner";

export type MarketingPageType =
  | "homepage"
  | "product"
  | "pricing"
  | "agency"
  | "freelancer"
  | "blog"
  | "knowledge_base"
  | "signup"
  | "login";

/**
 * 1. CTA clicked
 */
export function trackCtaClick(params: {
  ctaText: string;
  location: CtaLocation;
  pageType: MarketingPageType;
  targetUrl: string;
}) {
  pushGrowthEvent(
    "gigxomi_cta_clicked",
    sanitizePayload({
      cta_text: params.ctaText.trim(),
      location: params.location,
      page_type: params.pageType,
      target_url: params.targetUrl,
    })
  );
}

/**
 * 2. Pricing viewed
 */
export function trackPricingView(params: {
  billingCycle: "monthly" | "yearly";
  planCount?: number;
}) {
  pushGrowthEvent(
    "gigxomi_pricing_viewed",
    sanitizePayload({
      billing_cycle: params.billingCycle,
      plan_count: params.planCount ?? 2,
    })
  );
}

/**
 * 3. Billing cycle selected (monthly / yearly)
 */
export function trackBillingCycleSelected(cycle: "monthly" | "yearly") {
  pushGrowthEvent(
    "gigxomi_billing_cycle_selected",
    sanitizePayload({
      cycle,
    })
  );
}

/**
 * 4. Plan selected
 */
export function trackPlanSelected(params: {
  planId: string;
  planName: string;
  audience: "AGENCY" | "FREELANCER";
  cycle: "monthly" | "yearly";
}) {
  pushGrowthEvent(
    "gigxomi_plan_selected",
    sanitizePayload({
      plan_id: params.planId,
      plan_name: params.planName,
      audience: params.audience,
      cycle: params.cycle,
    })
  );
}

/**
 * 5. Signup started
 */
export function trackSignupStarted(params: {
  role: "agency" | "freelancer";
  source?: string;
}) {
  pushGrowthEvent(
    "gigxomi_signup_started",
    sanitizePayload({
      role: params.role,
      source: params.source || "organic",
    })
  );
}

/**
 * 6. Signup method selected (google / email / whatsapp)
 */
export function trackSignupMethodSelected(params: {
  method: "google" | "email" | "whatsapp";
  role: "agency" | "freelancer";
}) {
  pushGrowthEvent(
    "gigxomi_signup_method_selected",
    sanitizePayload({
      method: params.method,
      role: params.role,
    })
  );
}

/**
 * 7. Signup step completed
 */
export function trackSignupStepCompleted(params: {
  role: "agency" | "freelancer";
  stepNumber: number;
  stepName: string;
}) {
  pushGrowthEvent(
    "gigxomi_signup_step_completed",
    sanitizePayload({
      role: params.role,
      step_number: params.stepNumber,
      step_name: params.stepName,
    })
  );
}

/**
 * 8. Signup completed
 */
export function trackSignupCompleted(params: {
  role: "agency" | "freelancer";
  workspaceType?: string;
  workflowChoice?: string;
}) {
  pushGrowthEvent(
    "gigxomi_signup_completed",
    sanitizePayload({
      role: params.role,
      workspace_type: params.workspaceType ?? "standard",
      workflow_choice: params.workflowChoice,
    })
  );
}

/**
 * 9. Freelancer filter used in CoHub
 */
export function trackFreelancerFilterUsed(filterValue: string) {
  pushGrowthEvent(
    "gigxomi_freelancer_filter_used",
    sanitizePayload({
      filter_value: filterValue,
    })
  );
}

/**
 * 10. Portfolio played
 */
export function trackPortfolioPlayed(params: {
  editorId: string;
  mediaType: "video" | "youtube" | "vimeo" | "embed";
}) {
  pushGrowthEvent(
    "gigxomi_portfolio_played",
    sanitizePayload({
      editor_id: params.editorId,
      media_type: params.mediaType,
    })
  );
}

/**
 * 11. Freelancer profile opened
 */
export function trackFreelancerProfileOpened(params: {
  editorId: string;
  specialty?: string;
}) {
  pushGrowthEvent(
    "gigxomi_freelancer_profile_opened",
    sanitizePayload({
      editor_id: params.editorId,
      specialty: params.specialty,
    })
  );
}

/**
 * 12. FAQ opened
 */
export function trackFaqOpened(params: {
  faqId: string;
  question: string;
  page: MarketingPageType;
}) {
  pushGrowthEvent(
    "gigxomi_faq_opened",
    sanitizePayload({
      faq_id: params.faqId,
      question: params.question,
      page: params.page,
    })
  );
}

/**
 * 13. Conversion panel shown
 */
export function trackConversionPanelShown(params: {
  triggerType: "timer" | "scroll" | "exit_intent" | "cta_click";
  pageType: MarketingPageType;
  deviceCategory?: string;
}) {
  pushGrowthEvent(
    "gigxomi_conversion_panel_shown",
    sanitizePayload({
      trigger_type: params.triggerType,
      page_type: params.pageType,
      device_category: params.deviceCategory,
    })
  );
}

/**
 * 14. Conversion panel dismissed
 */
export function trackConversionPanelDismissed(params: {
  method: "close_btn" | "backdrop" | "escape" | "link_click";
  pageType: MarketingPageType;
}) {
  pushGrowthEvent(
    "gigxomi_conversion_panel_dismissed",
    sanitizePayload({
      method: params.method,
      page_type: params.pageType,
    })
  );
}

/**
 * 15. Conversion path selected from panel or section
 */
export function trackConversionPathSelected(params: {
  path: "agency" | "freelancer" | "manager_invite";
  pageType: MarketingPageType;
  location: CtaLocation;
}) {
  pushGrowthEvent(
    "gigxomi_conversion_path_selected",
    sanitizePayload({
      path: params.path,
      page_type: params.pageType,
      location: params.location,
    })
  );
}

/**
 * 16. Demo modal opened
 */
export function trackDemoModalOpened(params: {
  sourceLocation: CtaLocation;
  pageType: MarketingPageType;
}) {
  pushGrowthEvent(
    "gigxomi_demo_modal_opened",
    sanitizePayload({
      source_location: params.sourceLocation,
      page_type: params.pageType,
    })
  );
}

/**
 * 17. Demo requested (Strictly zero PII - only operational parameters)
 */
export function trackDemoRequested(params: {
  preferredContact: "email" | "whatsapp";
  teamSize: string;
  pageType: MarketingPageType;
}) {
  pushGrowthEvent(
    "gigxomi_demo_requested",
    sanitizePayload({
      preferred_contact: params.preferredContact,
      team_size: params.teamSize,
      page_type: params.pageType,
    })
  );
}

/**
 * 18. Signup path selected
 */
export function trackSignupPathSelected(params: {
  role: "agency" | "freelancer";
  sourceLocation: CtaLocation;
  pageType: MarketingPageType;
}) {
  pushGrowthEvent(
    "gigxomi_signup_path_selected",
    sanitizePayload({
      role: params.role,
      source_location: params.sourceLocation,
      page_type: params.pageType,
    })
  );
}

/**
 * 19. WhatsApp verification started (only if requested in secure flow)
 */
export function trackWhatsappVerificationStarted(params: {
  role: "agency" | "freelancer";
  stepNumber?: number;
}) {
  pushGrowthEvent(
    "gigxomi_whatsapp_verification_started",
    sanitizePayload({
      role: params.role,
      step_number: params.stepNumber,
    })
  );
}

