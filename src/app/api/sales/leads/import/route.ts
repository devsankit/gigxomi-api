import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { normalizePhone } from "@/lib/auth/normalize";
import { createSalesLead, createSalesLeadPoolItem, getSalesSnapshotForRole } from "@/lib/gigxomi/sales-store";

type ImportMode = "add_to_round_robin_queue" | "assign_to_selected_agent" | "add_directly_to_crm";
type ImportRow = Record<string, string>;

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5_000;

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pick(row: ImportRow, keys: string[]) {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    const value = row[normalized];
    if (value) return value.trim();
  }
  return "";
}

function parseDelimited(text: string, delimiter: "," | "\t") {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === "\"" && quoted && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (character === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

async function readRows(file: File) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("Contact files must be 5 MB or smaller.");
  const lowerName = file.name.toLowerCase();
  if (![".csv", ".tsv", ".xls", ".xlsx"].some((extension) => lowerName.endsWith(extension))) {
    throw new Error("Use a CSV, TSV, XLS, or XLSX contact file.");
  }
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<string[]>(firstSheet, { header: 1, raw: false, defval: "" });
  }
  const text = await file.text();
  return parseDelimited(text, lowerName.endsWith(".tsv") ? "\t" : ",");
}

function googleSheetExportUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a valid Google Sheets link.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "docs.google.com") {
    throw new Error("Only docs.google.com Google Sheets links are supported.");
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/(e\/)?([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("Paste a valid Google Sheets spreadsheet link.");
  const published = Boolean(match[1]);
  const spreadsheetId = match[2];
  const gid = url.searchParams.get("gid") || url.hash.match(/(?:^#|[?&])gid=(\d+)/)?.[1] || "0";
  return published
    ? `https://docs.google.com/spreadsheets/d/e/${spreadsheetId}/pub?output=csv&gid=${encodeURIComponent(gid)}`
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
}

async function readGoogleSheetRows(value: string) {
  const response = await fetch(googleSheetExportUrl(value), {
    cache: "no-store",
    headers: { Accept: "text/csv" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error("Google Sheets could not export this sheet. Share it as ‘Anyone with the link’ and try again.");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_IMPORT_BYTES) throw new Error("Google Sheet export must be 5 MB or smaller.");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_IMPORT_BYTES) throw new Error("Google Sheet export must be 5 MB or smaller.");
  const text = new TextDecoder().decode(buffer);
  if (/<!doctype html|<html/i.test(text.slice(0, 500))) {
    throw new Error("Google returned a sign-in page. Share the sheet as ‘Anyone with the link’ and try again.");
  }
  return parseDelimited(text, ",");
}

function normalizeRows(rows: string[][]) {
  const [headerRow, ...bodyRows] = rows;
  const headers = (headerRow ?? []).map((header) => normalizeKey(String(header)));
  return bodyRows.map((row) =>
    row.reduce<ImportRow>((record, value, index) => {
      const key = headers[index];
      if (key) record[key] = String(value ?? "");
      return record;
    }, {}),
  );
}

function contactKeys(input: { customerEmail?: string; customerName?: string; customerPhone?: string }) {
  const phone = normalizePhone(input.customerPhone ?? "");
  const email = String(input.customerEmail ?? "").trim().toLowerCase();
  const fallbackName = String(input.customerName ?? "").trim().toLowerCase();
  const keys = [phone ? `phone:${phone}` : "", email ? `email:${email}` : ""].filter(Boolean);
  return keys.length ? keys : fallbackName ? [`name:${fallbackName}`] : [];
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "SALES_AGENT"]);
  if (!authorization.ok) return authorization.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const googleSheetUrl = String(form?.get("googleSheetUrl") ?? "").trim();
  const uploadedFile = file instanceof File && file.size > 0 ? file : null;
  const hasFile = Boolean(uploadedFile);
  if (hasFile && googleSheetUrl) {
    return NextResponse.json({ ok: false, error: "Choose one source: a contact file or a Google Sheets link." }, { status: 400 });
  }
  if (!hasFile && !googleSheetUrl) {
    return NextResponse.json({ ok: false, error: "Upload a CSV, TSV, XLS, or XLSX file, or paste a Google Sheets link." }, { status: 400 });
  }

  const requestedMode = String(form?.get("mode") ?? "add_to_round_robin_queue") as ImportMode;
  const validModes: ImportMode[] = ["add_to_round_robin_queue", "assign_to_selected_agent", "add_directly_to_crm"];
  if (!validModes.includes(requestedMode)) {
    return NextResponse.json({ ok: false, error: "Choose a valid contact import destination." }, { status: 400 });
  }
  const isSalesAgent = authorization.session.role === "SALES_AGENT";
  const mode: ImportMode = isSalesAgent ? "add_directly_to_crm" : requestedMode;
  const assignedAgentId = String(form?.get("assignedAgentId") ?? "").trim();
  const snapshot = await getSalesSnapshotForRole(authorization.session);
  const selectedAgent = isSalesAgent
    ? snapshot.currentAgent
    : assignedAgentId
      ? snapshot.agents.find((agent) => agent.id === assignedAgentId)
      : null;
  const fallbackAgent = snapshot.agents.find((agent) => agent.status === "ACTIVE") ?? snapshot.agents[0] ?? null;

  if (isSalesAgent && !selectedAgent) {
    return NextResponse.json({ ok: false, error: "Your sales agent profile was not found." }, { status: 400 });
  }
  if (mode === "assign_to_selected_agent" && !selectedAgent) {
    return NextResponse.json({ ok: false, error: "Choose a sales agent for this import." }, { status: 400 });
  }
  if (mode === "add_directly_to_crm" && !selectedAgent && !fallbackAgent) {
    return NextResponse.json({ ok: false, error: "Create or select a sales agent before importing directly to CRM." }, { status: 400 });
  }

  let rawRows: string[][];
  try {
    rawRows = uploadedFile ? await readRows(uploadedFile) : await readGoogleSheetRows(googleSheetUrl);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to read the contact source." }, { status: 400 });
  }
  if (rawRows.length > MAX_IMPORT_ROWS + 1) {
    return NextResponse.json({ ok: false, error: `Import up to ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} contacts at a time.` }, { status: 400 });
  }
  if (rawRows.length < 2 || !rawRows[0]?.some((value) => String(value).trim())) {
    return NextResponse.json({ ok: false, error: "No contacts were found. Include a header row and at least one contact." }, { status: 400 });
  }
  const rows = normalizeRows(rawRows);
  const seen = new Set<string>();
  for (const lead of [...snapshot.visibleLeads, ...snapshot.visibleLeadPool]) {
    for (const key of contactKeys({ customerEmail: lead.customerEmail, customerName: lead.customerName, customerPhone: lead.customerPhone })) seen.add(key);
  }
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let duplicate = 0;
  let skipped = 0;

  for (const [index, row] of rows.entries()) {
    const customerName =
      pick(row, ["name", "full name", "customer name", "contact name", "customer"]) ||
      [pick(row, ["first name", "firstname", "given name"]), pick(row, ["last name", "lastname", "family name"])].filter(Boolean).join(" ");
    const customerPhone = pick(row, ["phone", "phone number", "cell phone", "contact no", "contact number", "mobile", "mobile number", "whatsapp", "whatsapp no", "whatsapp number"]);
    const customerEmail = pick(row, ["email", "e-mail", "email id", "email address"]);
    const dedupeKeys = contactKeys({ customerEmail, customerName, customerPhone });
    if (!customerName && !customerPhone && !customerEmail) {
      skipped += 1;
      errors.push({ row: index + 2, reason: "Missing name, phone, and email." });
      continue;
    }
    if (dedupeKeys.some((key) => seen.has(key))) {
      duplicate += 1;
      continue;
    }

    const payload = {
      assignedAgentId: mode === "add_to_round_robin_queue" ? selectedAgent?.id ?? null : selectedAgent?.id ?? fallbackAgent?.id ?? null,
      customerName: customerName || customerPhone || customerEmail || `Imported lead ${index + 1}`,
      customerPhone,
      customerEmail,
      source: pick(row, ["source"]) || "contact_import",
      serviceInterest: pick(row, ["service", "package", "interest", "service interest"]) || "Imported contact",
      segment: pick(row, ["segment"]),
      priority: pick(row, ["priority"]) || "normal",
      budgetAmount: Number(pick(row, ["budget", "amount"])) || 0,
      notes: pick(row, ["notes", "note"]),
      tags: pick(row, ["tags", "tag"]),
    };

    try {
      if (mode === "add_directly_to_crm" || mode === "assign_to_selected_agent") {
        await createSalesLead({
          ...payload,
          assignedAgentId: payload.assignedAgentId ?? fallbackAgent?.id ?? "",
          tags: payload.tags ? payload.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
          actorUserId: authorization.session.userId,
        });
      } else {
        await createSalesLeadPoolItem(payload);
      }
      imported += 1;
      for (const key of dedupeKeys) seen.add(key);
    } catch (error) {
      skipped += 1;
      errors.push({ row: index + 2, reason: error instanceof Error ? error.message : "Import failed." });
    }
  }

  return NextResponse.json({
    ok: true,
    imported,
    skipped,
    duplicate,
    invalid: errors.length,
    source: hasFile ? "file" : "google_sheets",
    errors: errors.slice(0, 25),
  });
}
