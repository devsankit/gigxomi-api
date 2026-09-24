export type TenantStatus = "Pending approval" | "Active" | "Suspended";
export type SubscriptionStatus = "Setup pending" | "Live" | "Renewal due";
export type TeamMembershipState = "Invited" | "Requested" | "Active" | "Suspended";
export type PaymentSecurityState = "Pending" | "Secured for editor" | "Released";

export type AgencyTenant = {
  id: string;
  name: string;
  slug: string;
  owner: string;
  whatsappNumber: string;
  whatsappDisplayName?: string;
  publicPageTitle?: string;
  publicPageDescription?: string;
  subscriptionPlan: string;
  seatLimit: number;
  activeEditors: number;
  activeManagers: number;
  showcaseUrl: string;
  status: TenantStatus;
  note: string;
};

export type AgencyManager = {
  id: string;
  name: string;
  role: string;
  queue: string;
  scope: string;
};

export type AgencyEditorSeat = {
  id: string;
  name: string;
  specialty: string;
  seatState: TeamMembershipState;
  source: "Gigxomi marketplace" | "Agency invite";
  maskedIdentity: string;
  assignmentEligible: boolean;
};

export type TeamJoinRequest = {
  id: string;
  tenantName: string;
  editorName: string;
  specialty: string;
  status: TeamMembershipState;
  seatImpact: string;
};

export type PaymentSecurityRecord = {
  id: string;
  project: string;
  tenantName: string;
  amount: string;
  status: PaymentSecurityState;
  releaseRule: string;
};

export type ShowcaseService = {
  id: string;
  title: string;
  category: string;
  priceRange: string;
  teamLead: string;
  route: string;
};

export const tenantNetworkMetrics = [
  { label: "Agency tenants", value: "14" },
  { label: "Active WhatsApp numbers", value: "11" },
  { label: "Team editors routed", value: "63" },
  { label: "Secured editor payouts", value: "INR 4.8L" },
];

export const agencyTenants: AgencyTenant[] = [
  {
    id: "tenant-gigxomi",
    name: "Gigxomi Studio",
    slug: "gigxomi-studio",
    owner: "Gigxomi Admin",
    whatsappNumber: "+91 99818 07309",
    subscriptionPlan: "Internal flagship tenant",
    seatLimit: 40,
    activeEditors: 28,
    activeManagers: 6,
    showcaseUrl: "/agency/gigxomi-studio",
    status: "Active",
    note: "Default operating agency under the Gigxomi super-admin umbrella.",
  },
];

export const superAdminApprovalQueue = [
  "Approve PPW Creative after WhatsApp template verification and setup fee receipt.",
  "Review renewal risk for agencies nearing their editor seat limit.",
  "Audit two externally collected jobs before marking them secured-for-editor.",
];

export const gigxomiAgencyManagers: AgencyManager[] = [
  { id: "mgr-1", name: "Rahul Manager", role: "Operations manager", queue: "Inbound + assignments", scope: "Leads, quotes, editor routing" },
  { id: "mgr-2", name: "Shweta Ops", role: "Agency manager", queue: "Follow-ups", scope: "Client follow-up, payment reminders" },
];

export const gigxomiAgencyEditors: AgencyEditorSeat[] = [
  {
    id: "seat-1",
    name: "Testing Freelancer",
    specialty: "Long-form YouTube editing",
    seatState: "Active",
    source: "Gigxomi marketplace",
    maskedIdentity: "Editor ID GX-201",
    assignmentEligible: true,
  },
  {
    id: "seat-2",
    name: "Nagouri Mahendra",
    specialty: "Short-form reels",
    seatState: "Active",
    source: "Agency invite",
    maskedIdentity: "Editor ID GX-118",
    assignmentEligible: true,
  },
  {
    id: "seat-3",
    name: "Jayanta Kundu",
    specialty: "Podcast editing",
    seatState: "Invited",
    source: "Agency invite",
    maskedIdentity: "Editor ID GX-442",
    assignmentEligible: false,
  },
];

export const freelancerTeamInvites = [
  {
    id: "invite-1",
    tenantName: "Editors Hub",
    owner: "Ankit Rathore",
    seatOffer: "Growth tenant seat",
    workType: "Recurring podcast and long-form client overflow",
    status: "Requested" as const,
  },
  {
    id: "invite-2",
    tenantName: "Gigxomi Studio",
    owner: "Gigxomi Admin",
    seatOffer: "Internal flagship team",
    workType: "Mixed marketplace and agency-assigned work",
    status: "Active" as const,
  },
];

export const teamJoinRequests: TeamJoinRequest[] = [
  {
    id: "req-1",
    tenantName: "Gigxomi Studio",
    editorName: "Jayanta Kundu",
    specialty: "Long-form podcast editing",
    status: "Invited",
    seatImpact: "Will use 1 of 40 seats after acceptance",
  },
  {
    id: "req-2",
    tenantName: "Gigxomi Studio",
    editorName: "Vaseek HR",
    specialty: "UGC short-form",
    status: "Active",
    seatImpact: "Seat already counted in active allocation",
  },
];

export const paymentSecurityRecords: PaymentSecurityRecord[] = [
  {
    id: "sec-1",
    project: "Finance With Rahul monthly clips",
    tenantName: "Gigxomi Studio",
    amount: "INR 4,900",
    status: "Secured for editor",
    releaseRule: "Release after delivery approval and no client dispute.",
  },
  {
    id: "sec-2",
    project: "PPW wedding teaser package",
    tenantName: "PPW Creative",
    amount: "INR 8,500",
    status: "Pending",
    releaseRule: "Editor cannot start until agency payment proof is verified by super admin.",
  },
];

export const agencyShowcaseServices: ShowcaseService[] = [
  {
    id: "svc-agency-1",
    title: "Monthly YouTube editing team",
    category: "Video Editing",
    priceRange: "Starts INR 4,500",
    teamLead: "Rahul Manager",
    route: "Leads land on agency WhatsApp first",
  },
  {
    id: "svc-agency-2",
    title: "Wedding teaser and reels bundle",
    category: "Video Editing",
    priceRange: "Starts INR 6,500",
    teamLead: "Shweta Ops",
    route: "Masked assignment to approved editor after manager review",
  },
];


