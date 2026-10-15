import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

export type StatusLabel = {
  id: string;
  name: string;
  color: string; // Hex color code (e.g. #ef4444, #10b981)
  description?: string;
  isDefault?: boolean;
  leadCount?: number;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_LABELS: StatusLabel[] = [
  { id: "lbl-hot", name: "Hot Lead", color: "#ef4444", description: "High purchase intent, ready to convert", isDefault: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "lbl-warm", name: "Warm Interest", color: "#f59e0b", description: "Evaluating packages, asked for proposal", isDefault: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "lbl-cold", name: "Cold Prospect", color: "#3b82f6", description: "Initial contact made, needs follow-up cadence", isDefault: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "lbl-high-budget", name: "High Budget", color: "#10b981", description: "Enterprise / high LTV agency prospect", isDefault: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "lbl-urgent-callback", name: "Urgent Callback", color: "#f43f5e", description: "Client requested callback at designated hour", isDefault: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "lbl-decision-maker", name: "Decision Maker", color: "#06b6d4", description: "In touch directly with founder / business owner", isDefault: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "lbl-price-sensitive", name: "Price Sensitive", color: "#8b5cf6", description: "Requested payment plan or discount terms", isDefault: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
];

const LABELS_FILE = path.join(process.cwd(), "data", "status-labels.json");

async function readStoredLabels(): Promise<StatusLabel[]> {
  try {
    const raw = await readFile(LABELS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_LABELS;
}

async function writeStoredLabels(labels: StatusLabel[]): Promise<void> {
  await mkdir(path.dirname(LABELS_FILE), { recursive: true });
  await writeFile(LABELS_FILE, JSON.stringify(labels, null, 2), "utf8");
}

export async function getStatusLabels(): Promise<StatusLabel[]> {
  const labels = await readStoredLabels();
  try {
    // Count leads tagged with each label
    const leads = await prisma.salesLeadAssignment.findMany({ select: { tags: true } });
    const counts = new Map<string, number>();
    for (const lead of leads) {
      for (const tag of lead.tags) {
        counts.set(tag.toLowerCase(), (counts.get(tag.toLowerCase()) || 0) + 1);
      }
    }
    return labels.map((l) => ({
      ...l,
      leadCount: counts.get(l.name.toLowerCase()) || 0,
    }));
  } catch {
    return labels.map((l) => ({ ...l, leadCount: 0 }));
  }
}

export async function createStatusLabel(input: { name: string; color: string; description?: string }): Promise<StatusLabel> {
  const name = input.name.trim();
  if (!name) throw new Error("Label name is required.");
  const labels = await readStoredLabels();
  if (labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A status label named "${name}" already exists.`);
  }

  const newLabel: StatusLabel = {
    id: `lbl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name,
    color: input.color.trim() || "#ff6b2f",
    description: input.description?.trim() || "",
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  labels.push(newLabel);
  await writeStoredLabels(labels);
  return newLabel;
}

export async function updateStatusLabel(id: string, input: { name?: string; color?: string; description?: string }): Promise<StatusLabel> {
  const labels = await readStoredLabels();
  const index = labels.findIndex((l) => l.id === id);
  if (index === -1) throw new Error("Status label not found.");

  const oldLabel = labels[index];
  const nextName = input.name ? input.name.trim() : oldLabel.name;
  if (!nextName) throw new Error("Label name cannot be empty.");

  if (input.name && nextName.toLowerCase() !== oldLabel.name.toLowerCase()) {
    if (labels.some((l) => l.id !== id && l.name.toLowerCase() === nextName.toLowerCase())) {
      throw new Error(`Another label named "${nextName}" already exists.`);
    }
    // Update tags on existing leads
    try {
      const affectedLeads = await prisma.salesLeadAssignment.findMany({
        where: { tags: { has: oldLabel.name } },
        select: { id: true, tags: true },
      });
      for (const lead of affectedLeads) {
        const nextTags = lead.tags.map((t) => (t === oldLabel.name ? nextName : t));
        await prisma.salesLeadAssignment.update({
          where: { id: lead.id },
          data: { tags: nextTags },
        });
      }
    } catch {}
  }

  const updated: StatusLabel = {
    ...oldLabel,
    name: nextName,
    color: input.color?.trim() || oldLabel.color,
    description: input.description !== undefined ? input.description.trim() : oldLabel.description,
    updatedAt: new Date().toISOString(),
  };

  labels[index] = updated;
  await writeStoredLabels(labels);
  return updated;
}

export async function deleteStatusLabel(id: string): Promise<{ ok: boolean; deletedName: string }> {
  const labels = await readStoredLabels();
  const target = labels.find((l) => l.id === id);
  if (!target) throw new Error("Status label not found.");

  // Remove tag from leads
  try {
    const affectedLeads = await prisma.salesLeadAssignment.findMany({
      where: { tags: { has: target.name } },
      select: { id: true, tags: true },
    });
    for (const lead of affectedLeads) {
      const nextTags = lead.tags.filter((t) => t !== target.name);
      await prisma.salesLeadAssignment.update({
        where: { id: lead.id },
        data: { tags: nextTags },
      });
    }
  } catch {}

  const filtered = labels.filter((l) => l.id !== id);
  await writeStoredLabels(filtered);
  return { ok: true, deletedName: target.name };
}

export async function toggleLeadStatusLabel(leadId: string, labelName: string): Promise<string[]> {
  const lead = await prisma.salesLeadAssignment.findUnique({
    where: { id: leadId },
    select: { id: true, tags: true },
  });
  if (!lead) throw new Error("Lead not found.");

  const currentTags = lead.tags || [];
  const exists = currentTags.some((t) => t.toLowerCase() === labelName.toLowerCase());
  const nextTags = exists
    ? currentTags.filter((t) => t.toLowerCase() !== labelName.toLowerCase())
    : [...currentTags, labelName];

  await prisma.salesLeadAssignment.update({
    where: { id: leadId },
    data: { tags: nextTags },
  });

  return nextTags;
}

export async function updateLeadTags(leadId: string, tags: string[]): Promise<string[]> {
  const lead = await prisma.salesLeadAssignment.findUnique({
    where: { id: leadId },
    select: { id: true },
  });
  if (!lead) throw new Error("Lead not found.");

  const sanitizedTags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  await prisma.salesLeadAssignment.update({
    where: { id: leadId },
    data: { tags: sanitizedTags },
  });

  return sanitizedTags;
}
