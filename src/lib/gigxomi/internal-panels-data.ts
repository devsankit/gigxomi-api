import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeIndianRupee,
  Bell,
  Blocks,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  Building2,
  Compass,
  FolderCog,
  FolderKanban,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  MessageSquare,
  MessageSquareText,
  Network,
  Package2,
  Radio,
  Receipt,
  ReceiptText,
  Send,
  Settings2,
  ShieldAlert,
  ShieldEllipsis,
  Sparkles,
  UserCheck,
  UserCog,
  Users,
  WalletCards,
} from "lucide-react";

export type SuperAdminSection =
  | "overview"
  | "learning"
  | "agencies"
  | "freelancers"
  | "approvals"
  | "packages"
  | "marketing"
  | "push-notifications"
  | "sales"
  | "knowledge-base"
  | "user-accounts"
  | "whatsapp-control"
  | "billing-control"
  | "editor-economics"
  | "ai-usage"
  | "platform-settings";

export type AdminSection =
  | "overview"
  | "roles"
  | "chat-inbox"
  | "project-tracking"
  | "assign-staff"
  | "managers"
  | "team-editors"
  | "team-requests"
  | "contacts"
  | "subscription"
  | "assignments"
  | "delivery-review"
  | "portfolio-review"
  | "payout-control"
  | "monetization"
  | "integrations"
  | "chatbot-builder"
  | "whatsapp-api-setup"
  | "instagram-inbox-setup"
  | "showcase-page"
  | "branding"
  | "agency-settings"
  | "agency-support";

export type ManagerSection =
  | "overview"
  | "chat-inbox"
  | "assigned-conversations"
  | "team-editors"
  | "contacts"
  | "verification-review"
  | "service-review"
  | "quote-review"
  | "project-tracking"
  | "assignments"
  | "delivery-review"
  | "portfolio-review"
  | "wallet-review"
  | "escalations";

export type InternalNavItem<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
  href?: string;
  group?: "main" | "operations" | "extensions" | "workspace";
};

export const superAdminNavItems: Array<InternalNavItem<SuperAdminSection>> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, href: "/super-admin" },
  { id: "learning", label: "Learning & Growth", icon: BookOpen, href: "/super-admin/learning" },
  { id: "agencies", label: "Agencies", icon: Users, href: "/super-admin/agencies" },
  { id: "freelancers", label: "Freelancers", icon: UserCog, href: "/super-admin/freelancers" },
  { id: "approvals", label: "Approvals", icon: ShieldEllipsis, href: "/super-admin/approvals" },
  { id: "packages", label: "Packages", icon: Package2, href: "/super-admin/packages" },
  { id: "marketing", label: "Marketing", icon: LineChart, href: "/super-admin/marketing" },
  { id: "push-notifications", label: "Push & Drip Notifications", icon: Bell, href: "/super-admin/push-notifications" },
  { id: "sales", label: "Sales Control", icon: Network, href: "/super-admin/sales" },
  { id: "knowledge-base", label: "Knowledge Base", icon: BookOpen, href: "/super-admin/knowledge-base" },
  { id: "user-accounts", label: "User Accounts", icon: UserCog, href: "/super-admin/signup" },
  { id: "whatsapp-control", label: "WhatsApp Control", icon: MessageSquareText, href: "/super-admin/whatsapp-control" },
  { id: "billing-control", label: "Billing Control", icon: ReceiptText, href: "/super-admin/billing-control" },
  { id: "editor-economics", label: "Editor Economics", icon: BadgeIndianRupee, href: "/super-admin/editor-economics" },
  { id: "ai-usage", label: "AI API Usage", icon: Activity, href: "/super-admin/ai-usage" },
  { id: "platform-settings", label: "Platform Settings", icon: Settings2, href: "/super-admin/platform-settings" },
];

export const adminNavItems: Array<InternalNavItem<AdminSection>> = [
  // High Frequency Daily Operations (Top)
  { id: "overview", label: "Overview", icon: LayoutDashboard, href: "/admin", group: "main" },
  { id: "chat-inbox", label: "Chat Inbox", icon: MessageSquare, href: "/admin/chat", group: "main" },
  { id: "project-tracking", label: "Project Tracking", icon: FolderKanban, href: "/admin/project-tracking", group: "operations" },
  { id: "assignments", label: "Work Hub", icon: BriefcaseBusiness, href: "/admin/assignments", group: "operations" },
  { id: "contacts", label: "Contacts", icon: Users, href: "/admin/contacts", group: "main" },

  // Team & Talent
  { id: "assign-staff", label: "Assign Staff", icon: UserCheck, href: "/admin/staff", group: "main" },
  { id: "team-editors", label: "Find Editors", icon: Compass, href: "/admin/freelancers", group: "main" },

  // Channels & Integrations
  { id: "integrations", label: "Integrations", icon: Blocks, href: "/admin/integrations", group: "extensions" },
  { id: "whatsapp-api-setup", label: "WhatsApp API Setup", icon: Radio, href: "/admin/integrations/whatsapp", group: "extensions" },
  { id: "instagram-inbox-setup", label: "Instagram Inbox Setup", icon: Send, href: "/admin/integrations/instagram", group: "extensions" },
  { id: "chatbot-builder", label: "Chatbot Builder", icon: Bot, href: "/admin/chatbot", group: "extensions" },

  // Finance, Settings & Support (Lower Frequency)
  { id: "payout-control", label: "Payout Requests", icon: Receipt, href: "/admin/payout-requests", group: "operations" },
  { id: "subscription", label: "Subscription", icon: Sparkles, href: "/admin/packages", group: "workspace" },
  { id: "agency-settings", label: "Agency Profile", icon: Building2, href: "/admin/system-settings", group: "main" },
  { id: "agency-support", label: "Support", icon: LifeBuoy, href: "https://wa.me/919993328124?text=Hello%20Gigxomi%20Support%2C%20I%20need%20assistance", group: "workspace" },
];

export const superAdminAppLabel = "Gigxomi super admin";
export const superAdminProfileName = "Gigxomi HQ";
export const superAdminProfileMeta = "Platform owner";
export const superAdminHeaderPills: string[] = [];

export const adminAppLabel = "Gigxomi agency admin";
export const adminProfileName = "Gigxomi Studio";
export const adminProfileMeta = "Agency owner";
export const adminHeaderPills: string[] = [];

export const managerNavItems: Array<InternalNavItem<ManagerSection>> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, href: "/manager", group: "main" },
  { id: "chat-inbox", label: "Chat Inbox", icon: MessageSquare, href: "/manager/chat", group: "main" },
  { id: "project-tracking", label: "Project Tracking", icon: FolderKanban, href: "/manager/project-tracking", group: "operations" },
  { id: "assignments", label: "Work Hub", icon: BriefcaseBusiness, href: "/manager/assignments", group: "operations" },
  { id: "contacts", label: "Contacts", icon: Users, href: "/manager/contacts", group: "main" },
  { id: "team-editors", label: "Find Editors", icon: Compass, href: "/manager/freelancers", group: "main" },
];

export const adminOverviewMetrics = [
  { label: "Freelancers", value: "257" },
  { label: "Managers", value: "6" },
  { label: "Pending approvals", value: "19" },
  { label: "Open WhatsApp threads", value: "41" },
];

export const adminRoleSummary = [
  { role: "Admin", note: "Full control of roles, integrations, packages, and moderation." },
  { role: "Manager", note: "Handles intake, assignment, approvals, quotes, delivery, and escalations." },
  { role: "Freelancer", note: "Own profile, services, chats, wallet, and delivery submission only." },
];

export const adminIntegrationCards = [
  { title: "WhatsApp API", brand: "whatsapp", note: "Webhook, templates, token health, and delivery events." },
  { title: "Instagram Inbox", brand: "instagram", note: "Live direct messaging, story mentions, and customer lane routing." },
  { title: "PhonePe", brand: "phonepe", note: "Direct UPI intent links, merchant callbacks, and zero-fee settlement." },
  { title: "Razorpay Partner", brand: "razorpay", note: "Instant partner onboarding for cards, netbanking, and domestic auto-settlement." },
  { title: "Stripe Global", brand: "stripe", note: "International cards, Apple Pay, and multi-currency client invoicing." },
  { title: "YouTube API", brand: "youtube", note: "Agency channel uploads for client review samples and approved portfolio showcases." },
  { title: "Google Drive", brand: "google-drive", note: "Project folder sync, raw footage intake, and 4K export deliveries." },
] as const;

export interface AdminAgencyPackageCard {
  id: string;
  key: "freemium" | "monthly" | "yearly";
  title: string;
  price: string;
  interval: string;
  savings?: string;
  badge: string;
  note: string;
  features: string[];
  billingCycle: "MONTHLY" | "YEARLY" | "CUSTOM";
  isRecommended?: boolean;
}

export const adminPackageCards: AdminAgencyPackageCard[] = [
  {
    id: "pkg-agency-freemium",
    key: "freemium",
    title: "Agency Freemium",
    price: "₹0",
    interval: "7 days free",
    badge: "7-Day Trial",
    note: "7-day unrestricted agency workspace with WhatsApp & Instagram intake for up to 2 editors.",
    features: [
      "Unified WhatsApp & Instagram Client Inbox",
      "Up to 2 Active Editors",
      "Manage 5 Active Client Projects",
      "Masked Two-Lane Chat (Anti-Poaching)",
      "Standard Stage Boards & Quotations",
    ],
    billingCycle: "CUSTOM",
  },
  {
    id: "pkg-agency-premium",
    key: "monthly",
    title: "Agency Premium Monthly",
    price: "₹2,000",
    interval: "/ month",
    badge: "Monthly Plan",
    note: "Full video agency operations with unlimited team capacity and multi-channel intake.",
    features: [
      "Unlimited Editors & Managers",
      "WhatsApp Business & Instagram Graph APIs",
      "Unlimited Client Projects & Deliveries",
      "Stage Boards, Deal Notes & Review Hub",
      "UPI Payout Accounting & Direct Settlement",
    ],
    billingCycle: "MONTHLY",
  },
  {
    id: "pkg-agency-premium",
    key: "yearly",
    title: "Agency Premium Yearly",
    price: "₹17,700",
    interval: "/ year",
    savings: "Save 26% · Save ₹6,300/year",
    badge: "Recommended · Save 26%",
    note: "Best value for established agencies (₹1,475/mo equivalent). One complete workspace.",
    features: [
      "Everything in Monthly Plan",
      "Save 26% vs Monthly (₹6,300 saved)",
      "Unlimited Editors, Managers & Projects",
      "Custom Agency Branding & Webhooks",
      "Dedicated VIP Priority Support",
    ],
    billingCycle: "YEARLY",
    isRecommended: true,
  },
];

export const managerOverviewMetrics = [
  { label: "Threads waiting", value: "12" },
  { label: "Assigned editors", value: "28" },
  { label: "Pending quote review", value: "9" },
  { label: "Delivery follow-ups", value: "5" },
];

export const managerEscalations = [
  "Wedding project needs faster editor confirmation before quote goes live.",
  "Two finance clients requested weekly retainers and need manager approval on pricing.",
  "One freelancer exceeded promised delivery window and needs a response-time review.",
];

export const managerAppLabel = "Gigxomi manager panel";
export const managerProfileName = "Rahul Manager";
export const managerProfileMeta = "Operations manager";
export const managerHeaderPills: string[] = [];
