import fs from "node:fs";
import path from "node:path";

export type MobileAssignmentRecord = {
  id: string;
  tenantId: string;
  agencyUserId: string;
  agencyName: string;
  freelancerId: string;
  freelancerName: string;
  managerId?: string | null;
  clientContactId?: string | null;
  taskId?: string | null;
  applicationId?: string | null;
  title: string;
  brief: string;
  category: string;
  deadline?: string | null;
  budgetAmount: number;
  priority: string;
  status: string;
  revisionStatus?: string | null;
  deliveryLinks: string[];
  notes: string;
  chatThreadId?: string | null;
  acceptedAt?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MobileDeliverySubmission = {
  id: string;
  assignmentId: string;
  tenantId: string;
  freelancerId: string;
  freelancerName: string;
  version: number;
  deliveryLinks: string[];
  notes: string;
  status: string;
  reviewedById?: string | null;
  reviewedByRole?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdAt: string;
  submittedAt?: string;
  updatedAt?: string;
};

export type MobileRevisionRequest = {
  id: string;
  assignmentId: string;
  submissionId: string;
  requestedById: string;
  requestedByName: string;
  reason: string;
  notes: string;
  dueDate?: string | null;
  createdAt: string;
};

export type MobilePaymentRequest = {
  id: string;
  assignmentId: string;
  requestedAmount: number;
  status: string;
  createdAt: string;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const ASSIGNMENTS_FILE = path.join(DATA_DIR, "assignments.json");
const SUBMISSIONS_FILE = path.join(DATA_DIR, "delivery-submissions.json");
const REVISIONS_FILE = path.join(DATA_DIR, "revisions.json");
const PAYMENT_REQS_FILE = path.join(DATA_DIR, "payment-requests.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson<T>(filePath: string, defaultVal: T): T {
  try {
    ensureDir();
    if (!fs.existsSync(filePath)) return defaultVal;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return defaultVal;
  }
}

function writeJson(filePath: string, data: unknown) {
  try {
    ensureDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to write json to", filePath, error);
  }
}

const SEED_ASSIGNMENTS: MobileAssignmentRecord[] = [
  {
    id: "assign-101",
    tenantId: "tenant-demo",
    agencyUserId: "user-agency-1",
    agencyName: "Apex Growth Agency",
    freelancerId: "user-freelancer-1",
    freelancerName: "Freelancer Pro",
    title: "E-Commerce Mobile App UI Design",
    brief: "Design 5 core high-fidelity mobile screens for checkout and catalog browsing with dark mode theme.",
    category: "Mobile Design",
    deadline: new Date(Date.now() + 86400000 * 3).toISOString(),
    budgetAmount: 12000,
    priority: "HIGH",
    status: "ASSIGNED",
    deliveryLinks: [],
    notes: "Please refer to brand assets provided in chat.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "assign-102",
    tenantId: "tenant-demo",
    agencyUserId: "user-agency-1",
    agencyName: "Apex Growth Agency",
    freelancerId: "user-freelancer-1",
    freelancerName: "Freelancer Pro",
    title: "Instagram Reels & Video Editing (Batch 1)",
    brief: "Edit 10 short-form reels with animated captions, hooks, and sound design.",
    category: "Video Editing",
    deadline: new Date(Date.now() + 86400000 * 5).toISOString(),
    budgetAmount: 8500,
    priority: "MEDIUM",
    status: "ACCEPTED",
    deliveryLinks: [],
    notes: "Raw footage uploaded in shared drive.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
];

export function getAssignments(): MobileAssignmentRecord[] {
  const items = readJson<MobileAssignmentRecord[]>(ASSIGNMENTS_FILE, []);
  if (!items.length) {
    writeJson(ASSIGNMENTS_FILE, SEED_ASSIGNMENTS);
    return SEED_ASSIGNMENTS;
  }
  return items;
}

export function getAssignmentById(id: string): MobileAssignmentRecord | null {
  const all = getAssignments();
  return all.find((a) => a.id === id) ?? null;
}

export function saveAssignment(assignment: MobileAssignmentRecord) {
  const all = getAssignments();
  const idx = all.findIndex((a) => a.id === assignment.id);
  assignment.updatedAt = new Date().toISOString();
  if (idx >= 0) {
    all[idx] = assignment;
  } else {
    all.push(assignment);
  }
  writeJson(ASSIGNMENTS_FILE, all);
}

export function getSubmissions(assignmentId: string): MobileDeliverySubmission[] {
  const all = readJson<MobileDeliverySubmission[]>(SUBMISSIONS_FILE, []);
  return all.filter((s) => s.assignmentId === assignmentId);
}

export function getSubmissionById(id: string): MobileDeliverySubmission | null {
  const all = readJson<MobileDeliverySubmission[]>(SUBMISSIONS_FILE, []);
  return all.find((s) => s.id === id) ?? null;
}

export function saveSubmission(submission: MobileDeliverySubmission) {
  const all = readJson<MobileDeliverySubmission[]>(SUBMISSIONS_FILE, []);
  const idx = all.findIndex((s) => s.id === submission.id);
  if (idx >= 0) {
    all[idx] = submission;
  } else {
    all.push(submission);
  }
  writeJson(SUBMISSIONS_FILE, all);
}

export function getRevisions(assignmentId: string): MobileRevisionRequest[] {
  const all = readJson<MobileRevisionRequest[]>(REVISIONS_FILE, []);
  return all.filter((r) => r.assignmentId === assignmentId);
}

export function saveRevision(revision: MobileRevisionRequest) {
  const all = readJson<MobileRevisionRequest[]>(REVISIONS_FILE, []);
  all.push(revision);
  writeJson(REVISIONS_FILE, all);
}

export function savePaymentRequest(req: MobilePaymentRequest) {
  const all = readJson<MobilePaymentRequest[]>(PAYMENT_REQS_FILE, []);
  all.push(req);
  writeJson(PAYMENT_REQS_FILE, all);
}
