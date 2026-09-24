export type RouteType = "CLIENT_VISIBLE" | "MANAGER_INTERNAL";

export type StatusConfig = {
  id: string;
  label: string;
  tone: "neutral" | "accent" | "warning" | "success";
  order: number;
  active: boolean;
};

export type AssignableUser = {
  id: string;
  name: string;
  username: string;
  role: "FREELANCER";
  specialty: string;
  availability: string;
};

export type Contact = {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  notes: string;
  assignedUserId: string;
  currentService: string;
  latestStatusId: string;
  unreadCount: number;
  lastActivity: string;
};

export type MessageEvent = {
  id: string;
  sender: string;
  body: string;
  timestamp: string;
  routeType: RouteType;
};

export type Conversation = {
  id: string;
  contactId: string;
  customer: string;
  serviceTitle: string;
  statusId: string;
  assigneeUserId: string;
  unreadCount: number;
  channel: "WHATSAPP";
  latestMessageAt: string;
  preview: string;
  waiting: boolean;
  quote: {
    basePrice: number;
    addons: number;
    discount: number;
    finalTotal: number;
    approvalState: string;
  };
  delivery: {
    state: string;
    expiresAt: string;
    latestUpload: string;
  };
  managerNote: string;
  portfolioPermission: string;
  messages: MessageEvent[];
};

export type FollowUp = {
  id: string;
  linkedName: string;
  dueAt: string;
  assignedUser: string;
  note: string;
  status: "Due today" | "Overdue" | "Scheduled";
};

export type CrmTemplate = {
  id: string;
  title: string;
  category: string;
  content: string;
};

export type Campaign = {
  id: string;
  name: string;
  audience: string;
  status: string;
  channel: string;
  sendWindow: string;
};

export type BotOrAgent = {
  id: string;
  name: string;
  purpose: string;
  active: boolean;
};

export const crmStatuses: StatusConfig[] = [
  { id: "new", label: "New Leads", tone: "accent", order: 1, active: true },
  { id: "agency-registered", label: "Agency Registered", tone: "accent", order: 2, active: true },
  { id: "agency-connected", label: "Agency Connected", tone: "accent", order: 3, active: true },
  { id: "training-booked", label: "Training Booked", tone: "success", order: 4, active: true },
  { id: "human-review", label: "Human Review", tone: "warning", order: 5, active: true },
  { id: "not-interested", label: "Not Interested", tone: "neutral", order: 6, active: true },
  { id: "assigned", label: "Editor Assigned", tone: "accent", order: 7, active: true },
  { id: "in-progress", label: "In Progress", tone: "warning", order: 8, active: true },
  { id: "for-review", label: "For Review", tone: "warning", order: 9, active: true },
  { id: "delivered", label: "Delivered", tone: "success", order: 10, active: true },
];

export const assignableFreelancers: AssignableUser[] = [
  { id: "freelancer-1", name: "Testing Freelancer", username: "testingfreelancer", role: "FREELANCER", specialty: "YouTube long-form", availability: "Available today" },
  { id: "freelancer-2", name: "Nagouri Mahendra", username: "nagourimahendra3", role: "FREELANCER", specialty: "Short-form reels", availability: "Available in 2 hours" },
  { id: "freelancer-3", name: "Shubh Agrawal", username: "shubhiagrawal104", role: "FREELANCER", specialty: "Performance editing", availability: "Available tomorrow" },
  { id: "freelancer-4", name: "Vaseek HR", username: "vaseekhr", role: "FREELANCER", specialty: "Short-form UGC", availability: "Available today" },
  { id: "freelancer-5", name: "Jayanta Kundu", username: "jayantakundu718", role: "FREELANCER", specialty: "Long-form podcast", availability: "Available today" },
];

export const crmContacts: Contact[] = [
  {
    id: "contact-riya",
    name: "Riya Sharma",
    phone: "+91 81234 65079",
    tags: ["wedding", "reels", "warm lead"],
    notes: "Needs editor shortlist plus quote draft before weekend.",
    assignedUserId: "freelancer-2",
    currentService: "Wedding teaser + reel package",
    latestStatusId: "new",
    unreadCount: 2,
    lastActivity: "2 min ago",
  },
  {
    id: "contact-rahul",
    name: "Finance With Rahul",
    phone: "+91 9988776655",
    tags: ["youtube", "retainer", "pricing-sensitive"],
    notes: "Looking for weekly YouTube long-form support under monthly budget.",
    assignedUserId: "freelancer-1",
    currentService: "YouTube long-form retainer",
    latestStatusId: "assigned",
    unreadCount: 0,
    lastActivity: "11 min ago",
  },
  {
    id: "contact-ayushi",
    name: "Ayushi Fitness",
    phone: "+91 9001122233",
    tags: ["fitness", "short-form", "awaiting quote"],
    notes: "Needs 20 reels per month and thumbnail variants.",
    assignedUserId: "freelancer-4",
    currentService: "Gym short-form editing",
    latestStatusId: "quote-sent",
    unreadCount: 1,
    lastActivity: "38 min ago",
  },
];

export const crmConversations: Conversation[] = [
  {
    id: "thread-riya",
    contactId: "contact-riya",
    customer: "Riya Sharma",
    serviceTitle: "Wedding teaser + reel package",
    statusId: "new",
    assigneeUserId: "freelancer-2",
    unreadCount: 2,
    channel: "WHATSAPP",
    latestMessageAt: "2 min ago",
    preview: "Need shortlist and quote draft for wedding teaser package.",
    waiting: true,
    quote: { basePrice: 5200, addons: 900, discount: 300, finalTotal: 5800, approvalState: "Manager review required" },
    delivery: { state: "Not started", expiresAt: "Will generate after upload", latestUpload: "No delivery yet" },
    managerNote: "Client wants teaser + reels bundle. Push fast turnaround but keep quality premium.",
    portfolioPermission: "Not requested yet",
    messages: [
      { id: "m1", sender: "Client", body: "Hi, I need someone for a wedding teaser and 3 reels. Can you help with a package?", timestamp: "10:02 AM", routeType: "CLIENT_VISIBLE" },
      { id: "m2", sender: "Manager", body: "Need shortlist plus quote draft. Prefer editors with wedding and fast delivery samples.", timestamp: "10:05 AM", routeType: "MANAGER_INTERNAL" },
      { id: "m3", sender: "Manager", body: "Assigned to Nagouri Mahendra for initial proposal draft.", timestamp: "10:07 AM", routeType: "MANAGER_INTERNAL" },
    ],
  },
  {
    id: "thread-rahul",
    contactId: "contact-rahul",
    customer: "Finance With Rahul",
    serviceTitle: "YouTube long-form retainer",
    statusId: "assigned",
    assigneeUserId: "freelancer-1",
    unreadCount: 0,
    channel: "WHATSAPP",
    latestMessageAt: "11 min ago",
    preview: "Client asked for 12 YouTube clips monthly under fixed budget.",
    waiting: false,
    quote: { basePrice: 4200, addons: 900, discount: 200, finalTotal: 4900, approvalState: "Direct client-payable quote still locked" },
    delivery: { state: "Revision preview sent", expiresAt: "28 Mar, 6:00 PM", latestUpload: "Preview batch 2 on Gigxomi YouTube" },
    managerNote: "Keep quote under INR 5,000 unless custom thumbnail pack is justified.",
    portfolioPermission: "Client permission pending",
    messages: [
      { id: "r1", sender: "Manager", body: "Client needs 12 edited YouTube clips per month. Start with base proposal and mention delivery batches.", timestamp: "10:12 AM", routeType: "MANAGER_INTERNAL" },
      { id: "r2", sender: "You", body: "I can do base plan at INR 4,800 if subtitles stay simple. Addon needed for custom thumbnail pack.", timestamp: "10:16 AM", routeType: "MANAGER_INTERNAL" },
      { id: "r3", sender: "Client", body: "Can you keep the budget under 5k and still handle two urgent uploads every week?", timestamp: "10:24 AM", routeType: "CLIENT_VISIBLE" },
    ],
  },
  {
    id: "thread-ayushi",
    contactId: "contact-ayushi",
    customer: "Ayushi Fitness",
    serviceTitle: "Gym short-form editing",
    statusId: "quote-sent",
    assigneeUserId: "freelancer-4",
    unreadCount: 1,
    channel: "WHATSAPP",
    latestMessageAt: "38 min ago",
    preview: "Quote sent, waiting for confirmation on monthly reels pack.",
    waiting: true,
    quote: { basePrice: 3600, addons: 1200, discount: 0, finalTotal: 4800, approvalState: "Sent to client" },
    delivery: { state: "Waiting payment", expiresAt: "No delivery yet", latestUpload: "No delivery yet" },
    managerNote: "Client is daily-basis lead candidate. Good one for monthly subscription upsell.",
    portfolioPermission: "Not requested yet",
    messages: [
      { id: "a1", sender: "Client", body: "Need 20 reels monthly for my gym brand. Do you also help with thumbnail variations?", timestamp: "Yesterday", routeType: "CLIENT_VISIBLE" },
      { id: "a2", sender: "Manager", body: "Draft quote approved. You can send final client-facing summary now.", timestamp: "Yesterday", routeType: "MANAGER_INTERNAL" },
    ],
  },
];

export const crmFollowUps: FollowUp[] = [
  { id: "fu-1", linkedName: "Riya Sharma", dueAt: "Today, 6:00 PM", assignedUser: "Rahul Manager", note: "Confirm wedding package turnaround before quote goes live.", status: "Due today" },
  { id: "fu-2", linkedName: "Finance With Rahul", dueAt: "Today, 8:30 PM", assignedUser: "Testing Freelancer", note: "Follow up after manager reviews budget-safe quote version.", status: "Due today" },
  { id: "fu-3", linkedName: "Ayushi Fitness", dueAt: "Yesterday, 5:00 PM", assignedUser: "Vaseek HR", note: "Client opened quote but has not replied yet.", status: "Overdue" },
  { id: "fu-4", linkedName: "Team Workmob", dueAt: "Tomorrow, 11:00 AM", assignedUser: "Rahul Manager", note: "Share first monthly retainer structure and payment schedule.", status: "Scheduled" },
];

export const crmTemplates: CrmTemplate[] = [
  { id: "tpl-intro", title: "Intro reply", category: "Intro", content: "Hi, thanks for reaching out to Gigxomi. I am reviewing the requirement and will share the right editor options shortly." },
  { id: "tpl-quote", title: "Quote follow-up", category: "Quote", content: "Sharing the updated proposal here. Please review the final amount, delivery timeline, and included revisions." },
  { id: "tpl-payment", title: "Payment reminder", category: "Payment", content: "Your quote is approved. Once payment is completed, we will lock the editor and begin work immediately." },
  { id: "tpl-delivery", title: "Delivery notice", category: "Delivery", content: "Your final delivery is ready. The Gigxomi delivery link will remain active for 8 days from the time of this message." },
  { id: "tpl-portfolio", title: "Portfolio permission", category: "Permission", content: "Would you allow this approved project to be showcased in the editor portfolio? We will only publish after your confirmation." },
];

export const crmCampaigns: Campaign[] = [
  { id: "camp-1", name: "Warm lead follow-up", audience: "Unread leads older than 24h", status: "Draft", channel: "WhatsApp", sendWindow: "Weekdays 11 AM" },
  { id: "camp-2", name: "Retainer upsell", audience: "Clients with 3+ delivered projects", status: "Paused", channel: "WhatsApp", sendWindow: "Fridays 4 PM" },
];

export const crmBots: BotOrAgent[] = [
  { id: "bot-1", name: "Lead triage bot", purpose: "Captures brief, budget, urgency, and service type before manager handoff.", active: true },
  { id: "bot-2", name: "Payment reminder bot", purpose: "Sends soft reminders after quote approval if payment is pending.", active: false },
];

export const crmAgents: BotOrAgent[] = [
  { id: "agent-1", name: "Quote copilot", purpose: "Suggests quote structure from service price, addons, and discount history.", active: true },
  { id: "agent-2", name: "Delivery reviewer", purpose: "Flags expiring delivery links and portfolio-permission opportunities.", active: false },
];

