export type WorkloadBand = "Low" | "Moderate" | "Busy" | "Near Capacity";
export type KarmaBand = "At Risk" | "Stable" | "Trusted" | "Elite";
export type RewardTier = "Bronze" | "Silver" | "Gold" | "Platinum";
export type HiringStatus = "Actively hiring" | "Selective hiring" | "Invite only";
export type TeamMembershipStatus = "Invited" | "Requested" | "Active" | "Suspended";
export type SubscriptionHealth = "Healthy" | "Watchlist" | "Renewal risk";

export type DashboardKpi = {
  label: string;
  value: string;
  note?: string;
};

export type WeightedRule = {
  label: string;
  weight: number;
  note: string;
};

export type InsightBar = {
  label: string;
  value: string;
  percentage: number;
  note?: string;
};

export type AgencyPlanSnapshot = {
  agencyId: string;
  agencyName: string;
  planName: string;
  seatLimit: number;
  activeSeats: number;
  invitedSeats: number;
  managerLimit: number;
  activeManagers: number;
  monthlySubscription: number;
  setupFee: number;
  subscriptionHealth: SubscriptionHealth;
  renewalWindow: string;
  monthlyRevenue: number;
  securedPayoutVolume: number;
};

export type AgencyDirectoryCard = {
  id: string;
  name: string;
  slug: string;
  niche: string;
  owner: string;
  location: string;
  hiringStatus: HiringStatus;
  activeEditors: number;
  seatLimit: number;
  openOpportunities: number;
  trustSummary: string;
  growthSummary: string;
  showcaseCta: string;
  activeServices: string;
  whatsappNumber: string;
};

export type EditorKarmaMetrics = {
  score: number;
  band: KarmaBand;
  responseSpeed: number;
  onTimeDelivery: number;
  revisionEfficiency: number;
  clientSatisfaction: number;
  managerCompliance: number;
  disputePenalty: number;
};

export type EditorLeaderMetrics = {
  score: number;
  tier: RewardTier;
  completedValue: number;
  repeatWork: number;
  consistency: number;
  lowDispute: number;
  responsiveness: number;
  multiAgencyImpact: number;
};

export type EditorPerformanceMetrics = {
  id: string;
  name: string;
  publicAlias: string;
  specialties: string[];
  activeChats: number;
  activeProjects: number;
  dueSoonDeliveries: number;
  activeAgencyCount: number;
  availability: "Available this week" | "Capacity opening soon" | "High load";
  workloadBand: WorkloadBand;
  disputesOpen: number;
  payoutReady: number;
  karma: EditorKarmaMetrics;
  leader: EditorLeaderMetrics;
};

export type EditorAgencyMembership = {
  editorId: string;
  agencyId: string;
  role: "Core editor" | "Overflow editor" | "Specialist";
  status: TeamMembershipStatus;
  activeSeatCounted: boolean;
};

export type EditorInvite = {
  id: string;
  agencyId: string;
  agencyName: string;
  editorId: string;
  status: TeamMembershipStatus;
  workType: string;
  seatOffer: string;
  note: string;
};

export type EditorPortfolioRequest = {
  id: string;
  editorId: string;
  agencyId: string;
  agencyName: string;
  status: "Sent" | "Shortlisted" | "Declined";
  summary: string;
  portfolioHook: string;
};

export type EditorApplication = {
  id: string;
  projectId: string;
  editorId: string;
  status: "Applied" | "Shortlisted" | "Selected" | "On hold";
  note: string;
};

export type AgencyProjectPost = {
  id: string;
  agencyId: string;
  agencyName: string;
  title: string;
  specialty: string;
  budgetRange: string;
  turnaround: string;
  urgency: "Low" | "Medium" | "High";
  experienceTag: string;
  minimumKarma: number;
  preferredWorkload: Exclude<WorkloadBand, "Near Capacity">;
  shortlistCount: number;
  openStatus: "Open" | "Shortlisting" | "Filled";
  teamMembershipRequired: boolean;
  visibility: "Matched editors only";
  matchedEditorIds: string[];
};

export type SuperAdminDashboardSnapshot = {
  kpis: DashboardKpi[];
  revenueSplit: InsightBar[];
  agencyGrowth: InsightBar[];
  disputeTrend: InsightBar[];
  subscriptionHealth: InsightBar[];
  topAgencies: Array<{
    agencyName: string;
    monthlyRevenue: string;
    editorUtilization: string;
    payoutSecurity: string;
  }>;
  approvalQueue: Array<{
    label: string;
    status: string;
    note: string;
  }>;
  whatsappQueue: Array<{
    agencyName: string;
    number: string;
    status: string;
    note: string;
  }>;
};

export type AdminDashboardSnapshot = {
  agency: AgencyDirectoryCard;
  plan: AgencyPlanSnapshot;
  kpis: DashboardKpi[];
  leaderboard: EditorPerformanceMetrics[];
  workloadDistribution: InsightBar[];
  inviteFunnel: InsightBar[];
  projectMix: InsightBar[];
  payoutStages: InsightBar[];
  scoreModel: {
    karma: WeightedRule[];
    leader: WeightedRule[];
  };
};

export type ManagerDashboardSnapshot = {
  kpis: DashboardKpi[];
  inboxQueue: Array<{
    label: string;
    status: string;
    note: string;
    owner: string;
  }>;
  assignmentBoard: Array<{
    title: string;
    editor: string;
    workload: WorkloadBand;
    note: string;
  }>;
  riskBoard: Array<{
    title: string;
    risk: string;
    note: string;
  }>;
  quoteBoard: Array<{
    title: string;
    stage: string;
    note: string;
  }>;
};

export type FreelancerDashboardSnapshot = {
  editor: EditorPerformanceMetrics;
  kpis: DashboardKpi[];
  invites: EditorInvite[];
  memberships: EditorAgencyMembership[];
  portfolioRequests: EditorPortfolioRequest[];
  applications: EditorApplication[];
  opportunities: AgencyProjectPost[];
  rewardHighlights: string[];
  karmaBreakdown: InsightBar[];
  payoutSummary: InsightBar[];
};

export const karmaScoreRules: WeightedRule[] = [
  { label: "Response speed", weight: 25, note: "Fast replies keep manager and client confidence high." },
  { label: "On-time delivery", weight: 25, note: "Late delivery is the fastest way to lose trust and repeat work." },
  { label: "Revision efficiency", weight: 15, note: "Low rework means better margins and smoother queues." },
  { label: "Client satisfaction proxy", weight: 15, note: "Manager notes and repeat requests stand in until native ratings mature." },
  { label: "Manager compliance", weight: 10, note: "Editors who follow scoped instructions create safer routing." },
  { label: "Dispute penalty", weight: 10, note: "Any dispute or missed commitment should suppress trust automatically." },
];

export const leaderScoreRules: WeightedRule[] = [
  { label: "Completed project value", weight: 25, note: "Higher-value work with clean delivery should earn more credit." },
  { label: "Repeat work contribution", weight: 20, note: "Reliable editors who keep accounts retained deserve more visibility." },
  { label: "Consistency streak", weight: 20, note: "Monthly streaks are ideal for reward campaigns and gifts." },
  { label: "Low dispute rate", weight: 15, note: "Leaderboards should reward calm operators, not risky volume." },
  { label: "Responsiveness", weight: 10, note: "Managers need editors who respond before queues slip." },
  { label: "Multi-agency impact", weight: 10, note: "Versatility across agencies makes the network more monetizable." },
];

export const agencyPlans: AgencyPlanSnapshot[] = [
  {
    agencyId: "tenant-gigxomi",
    agencyName: "Gigxomi Studio",
    planName: "Agency Freemium",
    seatLimit: 2,
    activeSeats: 1,
    invitedSeats: 0,
    managerLimit: 2,
    activeManagers: 1,
    monthlySubscription: 0,
    setupFee: 0,
    subscriptionHealth: "Healthy",
    renewalWindow: "Agency Freemium — 2 editors, 5 active projects",
    monthlyRevenue: 0,
    securedPayoutVolume: 0,
  },
  {
    agencyId: "tenant-editors-hub",
    agencyName: "Editors Hub",
    planName: "Growth",
    seatLimit: 12,
    activeSeats: 9,
    invitedSeats: 2,
    managerLimit: 3,
    activeManagers: 2,
    monthlySubscription: 28000,
    setupFee: 120000,
    subscriptionHealth: "Healthy",
    renewalWindow: "Renews in 18 days",
    monthlyRevenue: 214000,
    securedPayoutVolume: 126000,
  },
  {
    agencyId: "tenant-ppw",
    agencyName: "PPW Creative",
    planName: "Starter",
    seatLimit: 5,
    activeSeats: 3,
    invitedSeats: 1,
    managerLimit: 2,
    activeManagers: 1,
    monthlySubscription: 14000,
    setupFee: 80000,
    subscriptionHealth: "Watchlist",
    renewalWindow: "WhatsApp activation pending",
    monthlyRevenue: 98000,
    securedPayoutVolume: 32000,
  },
  {
    agencyId: "tenant-omni-flow",
    agencyName: "OmniFlow Studio",
    planName: "Scale",
    seatLimit: 20,
    activeSeats: 16,
    invitedSeats: 1,
    managerLimit: 5,
    activeManagers: 4,
    monthlySubscription: 42000,
    setupFee: 160000,
    subscriptionHealth: "Renewal risk",
    renewalWindow: "Renews in 5 days",
    monthlyRevenue: 336000,
    securedPayoutVolume: 184000,
  },
];

export const agencyDirectoryCards: AgencyDirectoryCard[] = [
  {
    id: "tenant-gigxomi",
    name: "Gigxomi Studio",
    slug: "gigxomi-studio",
    niche: "Creator growth and recurring YouTube editing",
    owner: "Gigxomi Admin",
    location: "Remote India",
    hiringStatus: "Actively hiring",
    activeEditors: 28,
    seatLimit: 40,
    openOpportunities: 6,
    trustSummary: "Flagship internal agency with stable payout trust and multi-manager routing.",
    growthSummary: "Fastest GMV growth this quarter across long-form and retention-led editing.",
    showcaseCta: "View flagship showcase",
    activeServices: "Long-form, short-form, thumbnails, ad edits",
    whatsappNumber: "+91 62676 05079",
  },
  {
    id: "tenant-editors-hub",
    name: "Editors Hub",
    slug: "editors-hub",
    niche: "Coach funnels, podcasts, and monthly retainers",
    owner: "Ankit Rathore",
    location: "Jaipur",
    hiringStatus: "Selective hiring",
    activeEditors: 9,
    seatLimit: 12,
    openOpportunities: 4,
    trustSummary: "Growing tenant focused on repeat creator retainers and overflow outsourcing.",
    growthSummary: "Strong subscription health and clean editor retention this month.",
    showcaseCta: "Browse agency page",
    activeServices: "Podcasts, coaches, shorts, webinar repurposing",
    whatsappNumber: "+91 91626 760507",
  },
  {
    id: "tenant-ppw",
    name: "PPW Creative",
    slug: "ppw-creative",
    niche: "Wedding films, teaser reels, and event storytelling",
    owner: "PPW No",
    location: "Lucknow",
    hiringStatus: "Actively hiring",
    activeEditors: 3,
    seatLimit: 5,
    openOpportunities: 3,
    trustSummary: "New tenant onboarding through Gigxomi with demand for event editors.",
    growthSummary: "Starter plan with room to grow once activation and onboarding close.",
    showcaseCta: "See wedding showcase",
    activeServices: "Wedding teasers, albums, highlight edits",
    whatsappNumber: "+91 99887 76655",
  },
  {
    id: "tenant-omni-flow",
    name: "OmniFlow Studio",
    slug: "omni-flow-studio",
    niche: "Short-form ad systems and D2C creative operations",
    owner: "Omini Operations",
    location: "Bengaluru",
    hiringStatus: "Invite only",
    activeEditors: 16,
    seatLimit: 20,
    openOpportunities: 2,
    trustSummary: "High-volume agency with strong ad editing systems and strict SLA rules.",
    growthSummary: "Seat utilization is near cap, which makes renewal and upsell timing critical.",
    showcaseCta: "Review growth agency",
    activeServices: "Ad creative, UGC repurposing, conversion edits",
    whatsappNumber: "+91 93725 55220",
  },
];

export const editorPerformanceProfiles: EditorPerformanceMetrics[] = [
  {
    id: "editor-testingfreelancer",
    name: "Testing Freelancer",
    publicAlias: "GX-201",
    specialties: ["Long-form YouTube", "Short-form repurposing", "Subtitles"],
    activeChats: 4,
    activeProjects: 5,
    dueSoonDeliveries: 2,
    activeAgencyCount: 2,
    availability: "Capacity opening soon",
    workloadBand: "Busy",
    disputesOpen: 0,
    payoutReady: 54050,
    karma: {
      score: 88,
      band: "Trusted",
      responseSpeed: 92,
      onTimeDelivery: 88,
      revisionEfficiency: 83,
      clientSatisfaction: 89,
      managerCompliance: 91,
      disputePenalty: 100,
    },
    leader: {
      score: 84,
      tier: "Gold",
      completedValue: 82,
      repeatWork: 86,
      consistency: 88,
      lowDispute: 93,
      responsiveness: 85,
      multiAgencyImpact: 76,
    },
  },
  {
    id: "editor-nagouri",
    name: "Nagouri Mahendra",
    publicAlias: "GX-118",
    specialties: ["Short-form reels", "Gym creative", "UGC ads"],
    activeChats: 3,
    activeProjects: 6,
    dueSoonDeliveries: 3,
    activeAgencyCount: 3,
    availability: "High load",
    workloadBand: "Near Capacity",
    disputesOpen: 1,
    payoutReady: 38100,
    karma: {
      score: 79,
      band: "Stable",
      responseSpeed: 85,
      onTimeDelivery: 78,
      revisionEfficiency: 76,
      clientSatisfaction: 82,
      managerCompliance: 80,
      disputePenalty: 58,
    },
    leader: {
      score: 81,
      tier: "Silver",
      completedValue: 90,
      repeatWork: 72,
      consistency: 75,
      lowDispute: 61,
      responsiveness: 84,
      multiAgencyImpact: 82,
    },
  },
  {
    id: "editor-jayanta",
    name: "Jayanta Kundu",
    publicAlias: "GX-442",
    specialties: ["Podcast editing", "Talking-head YouTube", "Audio polish"],
    activeChats: 2,
    activeProjects: 3,
    dueSoonDeliveries: 1,
    activeAgencyCount: 1,
    availability: "Available this week",
    workloadBand: "Moderate",
    disputesOpen: 0,
    payoutReady: 28600,
    karma: {
      score: 91,
      band: "Elite",
      responseSpeed: 94,
      onTimeDelivery: 92,
      revisionEfficiency: 88,
      clientSatisfaction: 90,
      managerCompliance: 95,
      disputePenalty: 100,
    },
    leader: {
      score: 87,
      tier: "Gold",
      completedValue: 78,
      repeatWork: 84,
      consistency: 91,
      lowDispute: 96,
      responsiveness: 87,
      multiAgencyImpact: 70,
    },
  },
  {
    id: "editor-umagfx",
    name: "Umesh Nagori",
    publicAlias: "GX-064",
    specialties: ["Graphic design", "Poster systems", "Thumbnail packs"],
    activeChats: 1,
    activeProjects: 2,
    dueSoonDeliveries: 1,
    activeAgencyCount: 2,
    availability: "Available this week",
    workloadBand: "Low",
    disputesOpen: 0,
    payoutReady: 22400,
    karma: {
      score: 86,
      band: "Trusted",
      responseSpeed: 88,
      onTimeDelivery: 84,
      revisionEfficiency: 86,
      clientSatisfaction: 85,
      managerCompliance: 89,
      disputePenalty: 100,
    },
    leader: {
      score: 77,
      tier: "Silver",
      completedValue: 70,
      repeatWork: 75,
      consistency: 79,
      lowDispute: 92,
      responsiveness: 74,
      multiAgencyImpact: 73,
    },
  },
];

export const editorAgencyMemberships: EditorAgencyMembership[] = [
  { editorId: "editor-testingfreelancer", agencyId: "tenant-gigxomi", role: "Core editor", status: "Active", activeSeatCounted: true },
  { editorId: "editor-testingfreelancer", agencyId: "tenant-editors-hub", role: "Overflow editor", status: "Requested", activeSeatCounted: false },
  { editorId: "editor-nagouri", agencyId: "tenant-gigxomi", role: "Specialist", status: "Active", activeSeatCounted: true },
  { editorId: "editor-nagouri", agencyId: "tenant-omni-flow", role: "Core editor", status: "Active", activeSeatCounted: true },
  { editorId: "editor-jayanta", agencyId: "tenant-gigxomi", role: "Overflow editor", status: "Invited", activeSeatCounted: false },
  { editorId: "editor-umagfx", agencyId: "tenant-editors-hub", role: "Specialist", status: "Active", activeSeatCounted: true },
];

export const editorInvites: EditorInvite[] = [
  {
    id: "invite-eh-testing",
    agencyId: "tenant-editors-hub",
    agencyName: "Editors Hub",
    editorId: "editor-testingfreelancer",
    status: "Requested",
    workType: "Monthly podcast repurposing and overflow edits",
    seatOffer: "Growth seat unlock after acceptance",
    note: "Agency wants one reliable YouTube editor before onboarding two managers.",
  },
  {
    id: "invite-ppw-testing",
    agencyId: "tenant-ppw",
    agencyName: "PPW Creative",
    editorId: "editor-testingfreelancer",
    status: "Invited",
    workType: "Wedding teaser overflow during seasonal peaks",
    seatOffer: "Starter seat reserved but not billed until active",
    note: "Strong fit once PPW completes activation and proof of secured payout.",
  },
];

export const editorPortfolioRequests: EditorPortfolioRequest[] = [
  {
    id: "portfolio-01",
    editorId: "editor-testingfreelancer",
    agencyId: "tenant-omni-flow",
    agencyName: "OmniFlow Studio",
    status: "Shortlisted",
    summary: "Applied with ad-edit case studies and retention reels portfolio.",
    portfolioHook: "Shown strong retention edits for D2C brands and fast hooks.",
  },
  {
    id: "portfolio-02",
    editorId: "editor-testingfreelancer",
    agencyId: "tenant-editors-hub",
    agencyName: "Editors Hub",
    status: "Sent",
    summary: "Portfolio request sent for long-form coach content and webinar clips.",
    portfolioHook: "Highlighted subtitle polish, pacing, and weekly batch systems.",
  },
];

export const editorApplications: EditorApplication[] = [
  {
    id: "apply-01",
    projectId: "project-editors-hub-coach",
    editorId: "editor-testingfreelancer",
    status: "Shortlisted",
    note: "Agency wants a final sample note before converting to active seat.",
  },
  {
    id: "apply-02",
    projectId: "project-ppw-teaser",
    editorId: "editor-testingfreelancer",
    status: "Applied",
    note: "Waiting for agency activation and quote approval.",
  },
];

export const agencyProjectPosts: AgencyProjectPost[] = [
  {
    id: "project-editors-hub-coach",
    agencyId: "tenant-editors-hub",
    agencyName: "Editors Hub",
    title: "Coach funnel editor for 12 weekly YouTube clips",
    specialty: "Long-form YouTube",
    budgetRange: "INR 18k-24k / month",
    turnaround: "Two uploads per week",
    urgency: "High",
    experienceTag: "Podcast and coach retainers",
    minimumKarma: 82,
    preferredWorkload: "Busy",
    shortlistCount: 4,
    openStatus: "Shortlisting",
    teamMembershipRequired: true,
    visibility: "Matched editors only",
    matchedEditorIds: ["editor-testingfreelancer", "editor-jayanta"],
  },
  {
    id: "project-ppw-teaser",
    agencyId: "tenant-ppw",
    agencyName: "PPW Creative",
    title: "Wedding teaser editor for cinematic same-week delivery",
    specialty: "Wedding editing",
    budgetRange: "INR 6k-8.5k / project",
    turnaround: "Delivery in 3 days",
    urgency: "Medium",
    experienceTag: "Teaser reels and music-led cuts",
    minimumKarma: 76,
    preferredWorkload: "Moderate",
    shortlistCount: 3,
    openStatus: "Open",
    teamMembershipRequired: true,
    visibility: "Matched editors only",
    matchedEditorIds: ["editor-testingfreelancer"],
  },
  {
    id: "project-omni-d2c",
    agencyId: "tenant-omni-flow",
    agencyName: "OmniFlow Studio",
    title: "D2C ad editor for skincare hooks and offer creatives",
    specialty: "Short-form ads",
    budgetRange: "INR 12k-16k / month",
    turnaround: "Daily ad lane",
    urgency: "High",
    experienceTag: "UGC and paid social ads",
    minimumKarma: 80,
    preferredWorkload: "Low",
    shortlistCount: 5,
    openStatus: "Open",
    teamMembershipRequired: true,
    visibility: "Matched editors only",
    matchedEditorIds: ["editor-nagouri", "editor-testingfreelancer"],
  },
  {
    id: "project-gigxomi-thumbnail",
    agencyId: "tenant-gigxomi",
    agencyName: "Gigxomi Studio",
    title: "Thumbnail systems designer for finance and creator channels",
    specialty: "Graphic design",
    budgetRange: "INR 9k-14k / month",
    turnaround: "48-hour batch delivery",
    urgency: "Low",
    experienceTag: "Thumbnail CTR improvement",
    minimumKarma: 74,
    preferredWorkload: "Moderate",
    shortlistCount: 2,
    openStatus: "Open",
    teamMembershipRequired: true,
    visibility: "Matched editors only",
    matchedEditorIds: ["editor-umagfx"],
  },
];

export const superAdminDashboardSnapshot: SuperAdminDashboardSnapshot = {
  kpis: [
    { label: "Total agencies", value: `${agencyDirectoryCards.length}`, note: "Internal + outside tenants" },
    { label: "Active subscriptions", value: "3 live / 1 onboarding", note: "Seat billing excludes invited members" },
    { label: "Subscription MRR", value: "INR 84,000", note: "Recurring SaaS layer from agencies" },
    { label: "Setup-fee revenue", value: "INR 3.6L", note: "One-time onboarding monetization" },
    { label: "Editor monetization", value: "INR 2.48L", note: "Commission or subscription yield" },
    { label: "Active editors", value: "56", note: "Across marketplace and agency teams" },
    { label: "Active managers", value: "13", note: "Tenant-scoped operations seats" },
    { label: "Secured payout volume", value: "INR 7.6L", note: "Jobs already safe for editor start" },
    { label: "Dispute watchlist", value: "3 editors", note: "Needs review before more assignment volume" },
    { label: "Renewal risk", value: "1 agency", note: "OmniFlow near cap and renewal window" },
  ],
  revenueSplit: [
    { label: "Agency SaaS", value: "INR 84K MRR", percentage: 26, note: "Setup + subscription layer" },
    { label: "Setup fees", value: "INR 3.6L YTD", percentage: 18, note: "Onboarding and WhatsApp launch" },
    { label: "Editor monetization", value: "INR 2.48L", percentage: 56, note: "Commission and editor plans" },
  ],
  agencyGrowth: [
    { label: "Gigxomi Studio", value: "+18%", percentage: 82, note: "Flagship creator retainer growth" },
    { label: "Editors Hub", value: "+12%", percentage: 68, note: "Coach and podcast recurring work" },
    { label: "PPW Creative", value: "+7%", percentage: 44, note: "Pending activation but wedding demand is healthy" },
    { label: "OmniFlow Studio", value: "+15%", percentage: 74, note: "High-volume D2C edits" },
  ],
  disputeTrend: [
    { label: "Open disputes", value: "3", percentage: 32, note: "Stable but needs attention on high-load editors" },
    { label: "Resolved this month", value: "5", percentage: 61, note: "Manager mediation improving" },
    { label: "Delivery misses", value: "4", percentage: 38, note: "Mostly from near-capacity editors" },
  ],
  subscriptionHealth: agencyPlans.map((plan) => ({
    label: plan.agencyName,
    value: plan.renewalWindow,
    percentage: Math.round((plan.activeSeats / plan.seatLimit) * 100),
    note: `${plan.activeSeats}/${plan.seatLimit} active seats`,
  })),
  topAgencies: agencyPlans
    .slice()
    .sort((left, right) => right.monthlyRevenue - left.monthlyRevenue)
    .map((plan) => ({
      agencyName: plan.agencyName,
      monthlyRevenue: `INR ${plan.monthlyRevenue.toLocaleString("en-IN")}`,
      editorUtilization: `${plan.activeSeats}/${plan.seatLimit} seats`,
      payoutSecurity: `INR ${plan.securedPayoutVolume.toLocaleString("en-IN")} secured`,
    })),
  approvalQueue: [
    {
      label: "PPW Creative onboarding",
      status: "Pending approval",
      note: "Verify WhatsApp template health and first secured payout proof before activation.",
    },
    {
      label: "OmniFlow renewal risk",
      status: "Needs action",
      note: "Seat utilization is 80%+ with high-load editors and a renewal window in 5 days.",
    },
    {
      label: "Editor dispute audit",
      status: "Super-admin review",
      note: "Two externally funded jobs need payout trust confirmation before release.",
    },
  ],
  whatsappQueue: agencyDirectoryCards.map((agency, index) => ({
    agencyName: agency.name,
    number: agency.whatsappNumber,
    status: index === 2 ? "Activation pending" : "Healthy",
    note: index === 2 ? "Business verification still waiting" : "Templates and routing checks are stable",
  })),
};

export const adminDashboardSnapshots: Record<string, AdminDashboardSnapshot> = {
  "tenant-gigxomi": {
    agency: agencyDirectoryCards[0],
    plan: agencyPlans[0],
    kpis: [
      { label: "Tenant revenue", value: "INR 6.42L", note: "Marketplace + routed agency work" },
      { label: "Active seats", value: "1 / 2", note: "Only active editors count toward billing" },
      { label: "Active chats", value: "41", note: "Across intake and routed threads" },
      { label: "Active projects", value: "23", note: "Client-facing and outsourced" },
      { label: "Secured payout amount", value: "INR 4.18L", note: "Editors can safely start" },
      { label: "Open disputes", value: "2", note: "Monitor before raising assignment load" },
      { label: "Average editor karma", value: "86", note: "Trusted band across the active pool" },
      { label: "Manager SLA health", value: "91%", note: "Reply and quote turnaround discipline" },
    ],
    leaderboard: editorPerformanceProfiles,
    workloadDistribution: [
      { label: "Low load", value: "7 editors", percentage: 25 },
      { label: "Moderate", value: "9 editors", percentage: 32 },
      { label: "Busy", value: "8 editors", percentage: 29 },
      { label: "Near Capacity", value: "4 editors", percentage: 14 },
    ],
    inviteFunnel: [
      { label: "Invites sent", value: "12", percentage: 100 },
      { label: "Portfolio requests in", value: "9", percentage: 75 },
      { label: "Accepted to team", value: "6", percentage: 50 },
      { label: "Seat-billed active", value: "4", percentage: 33 },
    ],
    projectMix: [
      { label: "Marketplace-origin projects", value: "58%", percentage: 58 },
      { label: "Agency-sourced projects", value: "42%", percentage: 42 },
      { label: "Recurring retainers", value: "64%", percentage: 64 },
    ],
    payoutStages: [
      { label: "Pending proof", value: "INR 62K", percentage: 18 },
      { label: "Secured-for-editor", value: "INR 4.18L", percentage: 72 },
      { label: "Released", value: "INR 1.22L", percentage: 34 },
    ],
    scoreModel: {
      karma: karmaScoreRules,
      leader: leaderScoreRules,
    },
  },
};

export const managerDashboardSnapshots: Record<string, ManagerDashboardSnapshot> = {
  "tenant-gigxomi": {
    kpis: [
      { label: "Waiting chats", value: "12", note: "Need first response or shortlist" },
      { label: "Assignment-ready editors", value: "8", note: "Trusted + not near capacity" },
      { label: "Pending quote reviews", value: "9", note: "Quotes awaiting manager send or edit" },
      { label: "Delivery risks", value: "5", note: "Due-soon or revision-heavy projects" },
      { label: "Escalations", value: "3", note: "Requires admin or super-admin oversight" },
      { label: "Security checks", value: "2", note: "Jobs blocked until secured-for-editor" },
    ],
    inboxQueue: [
      { label: "Finance With Rahul retainer", status: "Assigned", note: "Needs final quote confirmation under 5k base.", owner: "Rahul Manager" },
      { label: "Riya Sharma teaser package", status: "New", note: "Needs specialist shortlist and wedding lane pricing.", owner: "Shweta Ops" },
      { label: "Coach webinar clips", status: "Waiting", note: "Client asked for faster sample turnaround and batch workflow.", owner: "Rahul Manager" },
    ],
    assignmentBoard: [
      { title: "Testing Freelancer", editor: "Long-form lane", workload: "Busy", note: "Trusted enough for recurring projects but monitor due dates." },
      { title: "Jayanta Kundu", editor: "Podcast lane", workload: "Moderate", note: "Best candidate for new coach retainer after invite acceptance." },
      { title: "Nagouri Mahendra", editor: "Short-form ads", workload: "Near Capacity", note: "Avoid non-urgent assignments until delivery risk clears." },
    ],
    riskBoard: [
      { title: "Payment security hold", risk: "High", note: "PPW wedding project cannot start until secured-for-editor proof is verified." },
      { title: "Near-capacity editor", risk: "Medium", note: "Nagouri has 3 due-soon deliveries and one dispute watch item." },
      { title: "Unaccepted team invite", risk: "Low", note: "Coach retainer shortlist depends on Jayanta accepting agency request." },
    ],
    quoteBoard: [
      { title: "Finance retainer", stage: "Needs discount review", note: "Keep gross under client sensitivity threshold." },
      { title: "Wedding teaser", stage: "Package draft", note: "Add same-week delivery premium before sending." },
      { title: "Ad creative sprint", stage: "Secured hold", note: "Quote is ready but payout safety state is missing." },
    ],
  },
};

export function getFreelancerDashboardSnapshot(editorId = "editor-testingfreelancer"): FreelancerDashboardSnapshot {
  const editor = editorPerformanceProfiles.find((item) => item.id === editorId) ?? editorPerformanceProfiles[0];
  const invites = editorInvites.filter((item) => item.editorId === editor.id);
  const memberships = editorAgencyMemberships.filter((item) => item.editorId === editor.id);
  const portfolioRequests = editorPortfolioRequests.filter((item) => item.editorId === editor.id);
  const applications = editorApplications.filter((item) => item.editorId === editor.id);
  const opportunities = getRelevantAgencyProjectPosts(editor.id);

  return {
    editor,
    kpis: [
      { label: "Active agency memberships", value: `${memberships.filter((item) => item.status === "Active").length}`, note: `${editor.activeAgencyCount} agencies currently involved` },
      { label: "Active chats", value: `${editor.activeChats}`, note: "Routed threads still stay masked" },
      { label: "Active projects", value: `${editor.activeProjects}`, note: `${editor.dueSoonDeliveries} due soon` },
      { label: "Workload band", value: editor.workloadBand, note: editor.availability },
      { label: "Karma band", value: editor.karma.band, note: `${editor.karma.score}/100 trust score` },
      { label: "Reward tier", value: editor.leader.tier, note: `${editor.leader.score}/100 leader score` },
      { label: "Available payout", value: `INR ${editor.payoutReady.toLocaleString("en-IN")}`, note: "Cleared wallet amount" },
      { label: "Pending invites", value: `${invites.length + applications.length}`, note: "Invites and applications waiting" },
    ],
    invites,
    memberships,
    portfolioRequests,
    applications,
    opportunities,
    rewardHighlights: [
      "Trusted editors with 85+ karma can be auto-shortlisted for premium agencies.",
      "Gold and Platinum leader tiers become eligible for monthly gifts and visibility boosts.",
      "Near-capacity status reduces matching priority until delivery risk comes down.",
    ],
    karmaBreakdown: [
      { label: "Response speed", value: `${editor.karma.responseSpeed}`, percentage: editor.karma.responseSpeed },
      { label: "On-time delivery", value: `${editor.karma.onTimeDelivery}`, percentage: editor.karma.onTimeDelivery },
      { label: "Revision efficiency", value: `${editor.karma.revisionEfficiency}`, percentage: editor.karma.revisionEfficiency },
      { label: "Manager compliance", value: `${editor.karma.managerCompliance}`, percentage: editor.karma.managerCompliance },
    ],
    payoutSummary: [
      { label: "Available now", value: `INR ${editor.payoutReady.toLocaleString("en-IN")}`, percentage: 74 },
      { label: "Clearing soon", value: "INR 12,000", percentage: 18 },
      { label: "Held for review", value: "INR 4,900", percentage: 8 },
    ],
  };
}

export function getRelevantAgencyProjectPosts(editorId = "editor-testingfreelancer") {
  const editor = editorPerformanceProfiles.find((item) => item.id === editorId) ?? editorPerformanceProfiles[0];

  return agencyProjectPosts.filter((project) => {
    const matchesEditor = project.matchedEditorIds.includes(editor.id);
    const meetsKarma = editor.karma.score >= project.minimumKarma;
    const avoidsOverload = editor.workloadBand !== "Near Capacity" || project.preferredWorkload === "Low";
    return matchesEditor && meetsKarma && avoidsOverload;
  });
}

export function getActiveSeatUsage(agencyId: string) {
  return editorAgencyMemberships.filter((item) => item.agencyId === agencyId && item.status === "Active" && item.activeSeatCounted).length;
}

export function getPublicServiceSignals(seed: string) {
  const normalized = seed.toLowerCase();
  const hash = Array.from(normalized).reduce((total, character) => total + character.charCodeAt(0), 0);
  const trustOptions: KarmaBand[] = ["Stable", "Trusted", "Elite", "Trusted"];
  const workloadOptions: WorkloadBand[] = ["Low", "Moderate", "Busy", "Near Capacity"];
  const turnaroundOptions = ["48-hour lane", "Batch weekly lane", "Same-week delivery", "Priority monthly retainer"];
  const agencyCount = (hash % 4) + 1;
  const trust = trustOptions[hash % trustOptions.length];
  const workload = workloadOptions[hash % workloadOptions.length];
  const turnaround = turnaroundOptions[hash % turnaroundOptions.length];

  return {
    trust,
    workload,
    activeAgencySummary: `${agencyCount} active agenc${agencyCount === 1 ? "y" : "ies"}`,
    turnaround,
  };
}

export const publicAgencyReasons = [
  {
    title: "Own your WhatsApp number",
    note: "Clients talk to the agency brand while Gigxomi powers the masked routing and editor trust layer in the background.",
  },
  {
    title: "Pay only for active seats",
    note: "Invites and requests do not consume billing. Only editors who become active team members count toward the plan.",
  },
  {
    title: "Use ranked talent, not random inbox noise",
    note: "Project posts are matched to editor relevance using specialty, workload, and karma instead of open spam applications.",
  },
];
