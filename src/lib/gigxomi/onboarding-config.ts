import type { OnboardingChecklistDefinition } from "@/lib/gigxomi/onboarding-types";

export const onboardingChecklists: Record<string, OnboardingChecklistDefinition> = {
  freelancer_first_login: {
    key: "freelancer_first_login",
    role: "FREELANCER",
    title: "Freelancer onboarding",
    steps: [
      { id: "profile", title: "Complete profile", description: "Add your profile, skills, categories, pricing, and portfolio details.", route: "/freelancer/profile", ctaLabel: "Complete Profile", completionHint: "Profile required fields saved." },
      { id: "create_service", title: "Create first service", description: "Create your first service listing for marketplace discovery.", route: "/freelancer/add-service", ctaLabel: "Create Service", completionHint: "At least one service draft exists." },
      { id: "submit_service", title: "Submit or publish service", description: "Submit your service for approval or publish when allowed.", route: "/freelancer/services", ctaLabel: "Submit Service", completionHint: "Service status becomes pending/approved/published." },
      { id: "apply_work", title: "Apply for work", description: "Browse open work and submit your first application.", route: "/freelancer/apply-for-work", ctaLabel: "Find Work", completionHint: "At least one task application submitted." },
      { id: "team_request", title: "Respond to team request", description: "Review and accept/reject agency invites.", route: "/freelancer/apply-for-work", ctaLabel: "View Team Requests", completionHint: "No pending requests or request responded." },
      { id: "payout", title: "Track earnings and payouts", description: "Set up payout details and learn payout flow.", route: "/freelancer/payouts", ctaLabel: "Setup Payout", completionHint: "Payout details saved or page visited." },
      { id: "chat", title: "Open assigned chat", description: "Learn where active project conversations appear.", route: "/freelancer/chat", ctaLabel: "Open Chat", completionHint: "Chat page visited.", manualCompleteAllowed: true },
    ],
  },
  admin_first_login: {
    key: "admin_first_login",
    role: "ADMIN",
    title: "Agency admin onboarding",
    steps: [
      { id: "subscription", title: "Activate subscription", description: "Choose and activate your package.", route: "/admin/packages", ctaLabel: "Activate Package", completionHint: "Active subscription exists." },
      { id: "branding", title: "Set agency branding", description: "Add agency profile and branding basics.", route: "/admin/system-settings", ctaLabel: "Setup Branding", completionHint: "Agency settings saved.", manualCompleteAllowed: true },
      { id: "manager", title: "Add manager", description: "Create your first manager account if your package allows it.", route: "/admin/managers", ctaLabel: "Add Manager", completionHint: "Manager created or intentionally skipped.", manualCompleteAllowed: true },
      { id: "invite_freelancer", title: "Send an editor offer", description: "Find an editor and send your first agency offer.", route: "/admin/freelancers", ctaLabel: "Find Editors", completionHint: "Editor offer sent or accepted.", manualCompleteAllowed: true },
      { id: "publish_task", title: "Publish first assignment", description: "Create the first task for your team.", route: "/admin/assignments", ctaLabel: "Create Assignment", completionHint: "Task created." },
      { id: "delivery_review", title: "Review delivery workflow", description: "Understand approval and revision flow.", route: "/admin/delivery-review", ctaLabel: "Review Deliveries", manualCompleteAllowed: true },
      { id: "whatsapp", title: "Setup WhatsApp", description: "Connect WhatsApp if your package supports it.", route: "/admin/integrations/whatsapp", ctaLabel: "Connect WhatsApp", completionHint: "Connection status is connected.", manualCompleteAllowed: true },
      { id: "payments", title: "Review payouts", description: "Understand payable and payout request flow.", route: "/admin/payout-requests", ctaLabel: "Review Payments", manualCompleteAllowed: true },
    ],
  },
  manager_first_login: {
    key: "manager_first_login",
    role: "MANAGER",
    title: "Manager onboarding",
    steps: [
      { id: "chat", title: "Open assigned chats", description: "Start from your assigned conversations.", route: "/manager/chat", ctaLabel: "Open Chats", manualCompleteAllowed: true },
      { id: "tracking", title: "Project tracking", description: "Track project timelines and statuses.", route: "/manager/project-tracking", ctaLabel: "Open Tracking", manualCompleteAllowed: true },
      { id: "review", title: "Review queue", description: "Handle service and delivery review queue.", route: "/manager/service-review", ctaLabel: "Open Review Queue", manualCompleteAllowed: true },
      { id: "contacts", title: "Contacts", description: "Work with contact records when permission allows.", route: "/manager/contacts", ctaLabel: "Open Contacts", manualCompleteAllowed: true },
    ],
  },
  sales_agent_first_login: {
    key: "sales_agent_first_login",
    role: "SALES_AGENT",
    title: "Sales agent onboarding",
    steps: [
      { id: "queue", title: "Review lead queue", description: "Start from the open lead queue and claim the right prospects.", route: "/sales", ctaLabel: "Open Lead Queue", manualCompleteAllowed: true },
      { id: "crm", title: "Update CRM pipeline", description: "Move leads through contact, qualification, quote, payment, and handoff stages.", route: "/sales", ctaLabel: "Open CRM", manualCompleteAllowed: true },
      { id: "referrals", title: "Share referral links", description: "Use tracked package and pricing links so attribution stays clean.", route: "/sales", ctaLabel: "Open Referrals", manualCompleteAllowed: true },
      { id: "earnings", title: "Track earnings", description: "Review commissions and payout status before requesting a payout.", route: "/sales", ctaLabel: "Open Earnings", manualCompleteAllowed: true },
    ],
  },
  super_admin_first_login: {
    key: "super_admin_first_login",
    role: "SUPER_ADMIN",
    title: "Super admin onboarding",
    steps: [
      { id: "intelligence", title: "Check intelligence center", description: "Start from global intelligence snapshot.", route: "/super-admin", ctaLabel: "Open Intelligence", manualCompleteAllowed: true },
      { id: "packages", title: "Setup packages", description: "Configure and review package offerings.", route: "/super-admin/packages", ctaLabel: "Open Packages", manualCompleteAllowed: true },
      { id: "agencies", title: "Review agencies", description: "Audit agency activity and states.", route: "/super-admin/agencies", ctaLabel: "Open Agencies", manualCompleteAllowed: true },
      { id: "freelancers", title: "Review freelancers", description: "Audit freelancer health and activity.", route: "/super-admin/freelancers", ctaLabel: "Open Freelancers", manualCompleteAllowed: true },
      { id: "whatsapp_control", title: "Setup WhatsApp control", description: "Review platform-wide WhatsApp controls.", route: "/super-admin/whatsapp-control", ctaLabel: "Open WhatsApp Control", manualCompleteAllowed: true },
      { id: "billing", title: "Setup billing control", description: "Review billing controls and states.", route: "/super-admin/billing-control", ctaLabel: "Open Billing", manualCompleteAllowed: true },
    ],
  },
};

export const onboardingChecklistByRole = {
  FREELANCER: onboardingChecklists.freelancer_first_login,
  ADMIN: onboardingChecklists.admin_first_login,
  MANAGER: onboardingChecklists.manager_first_login,
  SALES_AGENT: onboardingChecklists.sales_agent_first_login,
  SUPER_ADMIN: onboardingChecklists.super_admin_first_login,
} as const;
