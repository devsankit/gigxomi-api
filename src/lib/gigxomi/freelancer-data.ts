export type FreelancerSection =
  | "dashboard"
  | "projects"
  | "add-service"
  | "draft-services"
  | "published-services"
  | "apply-work"
  | "chats"
  | "services"
  | "portfolio-drafts"
  | "profile"
  | "wallet"
  | "payouts";

export type WizardStepId = "signup" | "profile" | "payment" | "finish";
export type FreelancerChatRoute = "client" | "manager";

export type FreelancerChatMessage = {
  sender: string;
  route: FreelancerChatRoute;
  body: string;
  timestamp: string;
};

export type FreelancerChatThread = {
  id: string;
  customer: string;
  maskedCustomer?: string;
  summary: string;
  status: string;
  assignedService: string;
  deadline: string;
  routeDefault: string;
  managerNote: string;
  messages: FreelancerChatMessage[];
  quote: {
    basePrice: number;
    addons: number;
    discount: number;
    finalTotal: number;
    canSendDirectly: boolean;
    approvalReason: string;
  };
  delivery: {
    latestUpload: string;
    expiresIn: string;
    note: string;
  };
};

export const onboardingWizardSteps = [
  {
    id: "signup" as const,
    label: "Signup",
    title: "Create your freelancer account",
    description: "Use Google or email/password. Phone number is required so Gigxomi can route WhatsApp work correctly.",
  },
  {
    id: "profile" as const,
    label: "Profile",
    title: "Complete your working profile",
    description: "Add your public identity, profession, languages, and bio before you post services.",
  },
  {
    id: "payment" as const,
    label: "Payment",
    title: "Choose plan and add payout details",
    description: "Pick the commission model and save the bank account where Gigxomi should settle your net earnings.",
  },
  {
    id: "finish" as const,
    label: "Finish",
    title: "Ready to post your first service",
    description: "Your dashboard opens next. Verification stays inside Profile and publishing still needs admin approval.",
  },
];

export const freelancerNavItems: Array<{ id: FreelancerSection; label: string; href?: string }> = [
  { id: "dashboard", label: "Dashboard", href: "/freelancer" },
  { id: "chats", label: "Chats", href: "/freelancer/chat" },
  { id: "projects", label: "Project Tracking", href: "/freelancer/projects" },
  { id: "apply-work", label: "Apply for Work", href: "/freelancer/apply-for-work" },
  { id: "services", label: "My Services", href: "/freelancer/services" },
  { id: "payouts", label: "Earnings", href: "/freelancer/payouts" },
  { id: "profile", label: "Profile", href: "/freelancer/profile" },
];

export const monetizationPlans = [
  {
    id: "standard",
    name: "Standard",
    badge: "30% commission",
    description: "No subscription bill. Gigxomi keeps 30% from every paid quote and credits the remaining amount to wallet.",
    effectiveFee: "30%",
  },
  {
    id: "monthly",
    name: "Subscription Monthly",
    badge: "5% fee",
    description: "Monthly plan with only 5% transaction fee on each successful client payment.",
    effectiveFee: "5%",
  },
  {
    id: "quarterly",
    name: "Subscription Quarterly",
    badge: "5% fee",
    description: "Quarterly billing with 5% transaction fee. Built for editors handling repeat client work.",
    effectiveFee: "5%",
  },
  {
    id: "yearly",
    name: "Subscription Yearly",
    badge: "5% fee",
    description: "Yearly billing with 5% transaction fee and lower operational friction for high-volume editors.",
    effectiveFee: "5%",
  },
];

export const dashboardSummary = [
  { label: "Projects received", value: "42" },
  { label: "Active projects", value: "6" },
  { label: "Completed projects", value: "31" },
  { label: "Assigned chats", value: "4" },
  { label: "Pending payout", value: "INR 18,450" },
  { label: "Verification", value: "Pending ID review" },
];

export const karmaMetrics = [
  {
    label: "Response-time score",
    value: "92",
    note: "Median reply time 8 minutes during working hours.",
  },
  {
    label: "On-time completion",
    value: "88",
    note: "9 of the last 10 projects were delivered within promised timeline.",
  },
  {
    label: "Client rating score",
    value: "4.8 / 5",
    note: "Will improve after native review collection goes live.",
  },
  {
    label: "Overall karma",
    value: "Trusted",
    note: "Direct client-payable quotes unlock only after admin approval on top of this score.",
  },
];

export const freelancerActionQueue = [
  "Upload government ID inside Profile to move verification from pending to reviewed.",
  "Post at least one service draft after profile completion.",
  "Choose whether you want 30% commission or 5% subscription model.",
  "Keep response-time score above 85 to qualify for direct quote rights later.",
];

export const serviceDraftSections = [
  "Buyer-facing title and summary",
  "SEO title, description, and niche tags",
  "Price, delivery time, and revisions",
  "Addons and FAQ",
  "Sample media publishing",
];

export const services = [
  {
    id: "svc-101",
    title: "Wedding teaser editor for reels and cinematic highlights",
    category: "Video Editing",
    status: "Approved",
    price: "INR 4,500",
    deliveryTime: "3 Days",
    source: "Gigxomi YouTube (Unlisted)",
    performance: "12 inquiries this month",
  },
  {
    id: "svc-102",
    title: "Short-form content editor for coaches and YouTube channels",
    category: "Video Editing",
    status: "Pending review",
    price: "INR 2,200",
    deliveryTime: "2 Days",
    source: "Gigxomi YouTube (Unlisted)",
    performance: "Awaiting admin approval",
  },
  {
    id: "svc-201",
    title: "Thumbnail and poster design pack for creators",
    category: "Graphic Design",
    status: "Draft",
    price: "INR 1,800",
    deliveryTime: "1 Day",
    source: "Gigxomi Drive previews",
    performance: "Complete SEO fields before submission",
  },
];

export const managerInbox = [
  {
    id: "lead-01",
    customer: "Riya Sharma",
    status: "New",
    channel: "WhatsApp",
    assignedTo: "Manager queue",
    nextAction: "Wedding teaser + reel package inquiry. Needs editor shortlist and quote draft.",
  },
  {
    id: "lead-02",
    customer: "Finance With Rahul",
    status: "Assigned",
    channel: "WhatsApp",
    assignedTo: "testingfreelancer",
    nextAction: "YouTube editor under fixed monthly retainer. Client asked for turnaround and revision terms.",
  },
];

export const freelancerChats: FreelancerChatThread[] = [
  {
    id: "thread-01",
    customer: "Finance With Rahul",
    maskedCustomer: "Client GX-204",
    summary: "Long-form YouTube editor under monthly budget",
    status: "Assigned",
    assignedService: "Short-form content editor for coaches and YouTube channels",
    deadline: "Quote follow-up due today, 6:00 PM",
    routeDefault: "Talk with manager",
    managerNote: "Client is price-sensitive. Keep quote under INR 5,000 unless addon is justified.",
    messages: [
      {
        sender: "Manager",
        route: "manager",
        body: "Client needs 12 edited YouTube clips per month. Start with a base proposal and mention delivery batches.",
        timestamp: "10:12 AM",
      },
      {
        sender: "You",
        route: "manager",
        body: "I can do base plan at INR 4,800 if subtitles stay simple. Addon needed for custom thumbnail pack.",
        timestamp: "10:16 AM",
      },
      {
        sender: "Client",
        route: "client",
        body: "Can you keep the budget under 5k and still handle two urgent uploads every week?",
        timestamp: "10:24 AM",
      },
    ],
    quote: {
      basePrice: 4200,
      addons: 900,
      discount: 200,
      finalTotal: 4900,
      canSendDirectly: false,
      approvalReason: "Karma score is strong, but direct client-payable quote rights still need admin approval.",
    },
    delivery: {
      latestUpload: "none",
      expiresIn: "8 days after delivery",
      note: "Client gets Gigxomi-controlled Drive link with exact expiry message inside chat.",
    },
  },
  {
    id: "thread-02",
    customer: "Riya Sharma",
    maskedCustomer: "Client GX-118",
    summary: "Wedding highlights and teaser reel package",
    status: "Awaiting assignment",
    assignedService: "Wedding teaser editor for reels and cinematic highlights",
    deadline: "Manager shortlist pending",
    routeDefault: "Talk with manager",
    managerNote: "Lead came in through WhatsApp this morning. Wedding and teaser specialization is priority.",
    messages: [
      {
        sender: "Manager",
        route: "manager",
        body: "Hold this until I confirm whether we position you or another editor for the teaser package.",
        timestamp: "11:04 AM",
      },
    ],
    quote: {
      basePrice: 6500,
      addons: 2000,
      discount: 0,
      finalTotal: 8500,
      canSendDirectly: false,
      approvalReason: "Manager approval required before the quote becomes payable.",
    },
    delivery: {
      latestUpload: "none",
      expiresIn: "8 days after delivery",
      note: "Once approved, final wedding files should be uploaded to Gigxomi delivery storage instead of personal Drive.",
    },
  },
];

export const walletOverview = {
  grossEarned: "INR 84,500",
  commissionDeducted: "INR 18,450",
  pendingClearance: "INR 12,000",
  availableForWithdrawal: "INR 54,050",
  withdrawnAmount: "INR 22,000",
};

export const walletLedger = [
  {
    id: "led-001",
    title: "YouTube monthly editing package",
    gross: "INR 7,200",
    commission: "INR 2,160",
    net: "INR 5,040",
    status: "Available",
  },
  {
    id: "led-002",
    title: "Wedding teaser package",
    gross: "INR 12,500",
    commission: "INR 3,750",
    net: "INR 8,750",
    status: "Pending clearance",
  },
  {
    id: "led-003",
    title: "Subscription editor package",
    gross: "INR 9,000",
    commission: "INR 450",
    net: "INR 8,550",
    status: "Paid out",
  },
];

export const payoutRequests = [
  {
    id: "pay-01",
    amount: "INR 18,000",
    status: "Requested",
    note: "Weekly withdrawal for cleared balances.",
  },
  {
    id: "pay-02",
    amount: "INR 12,500",
    status: "Paid",
    note: "Transferred to HDFC ending 2041.",
  },
];

export const profileData = {
  fullName: "Testing Freelancer",
  username: "testingfreelancer",
  profession: "Video editor / Motion graphics",
  phone: "9999999999",
  languages: "English, Hindi",
  bio: "I edit short-form and long-form creator content with clean pacing, subtitles, and retention-focused hooks.",
  monetizationPlan: "Standard 30% commission",
  verificationStatus: "Pending review",
};

export const freelancerAppLabel = "Gigxomi freelancer app";
export const freelancerProfileName = profileData.username;
export const freelancerProfileMeta = profileData.monetizationPlan;
export const freelancerHeaderPills = ["WhatsApp workspaces live"];

export const verificationChecklist = [
  "Upload government ID",
  "Match ID name with bank account holder",
  "Provide current address",
  "Wait for admin review before public publishing",
];

export const payoutRules = [
  "Standard plan keeps 30% from every successful client payment.",
  "Subscription plans keep only 5% transaction fee.",
  "Wallet credit always uses the final approved paid quote, not raw service card price.",
  "Client delivery links expire after 8 days but Gigxomi keeps an internal audit copy.",
];

