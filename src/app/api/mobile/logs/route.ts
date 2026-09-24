import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

type LogEntry = {
  timestamp: string;
  eventName: string;
  level: "info" | "warn" | "error";
  userId?: string | null;
  role?: string | null;
  device?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: Record<string, unknown> | string;
};

type LogsPayload = {
  events: LogEntry[];
};

const LOGS_DIR = path.join(process.cwd(), "logs");

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

export async function POST(request: Request) {
  let payload: LogsPayload;
  try {
    payload = (await request.json()) as LogsPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) {
    return NextResponse.json({ ok: true, ingested: 0 });
  }

  try {
    ensureLogsDir();
    const today = new Date().toISOString().slice(0, 10);
    const logFilePath = path.join(LOGS_DIR, `mobile-events-${today}.log`);

    const logLines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.appendFileSync(logFilePath, logLines, "utf8");

    // Also output critical errors to stdout for PM2/Hostinger error logs
    for (const e of events) {
      if (e.level === "error") {
        console.error(`[MOBILE ERROR] [${e.eventName}] User: ${e.userId || "anonymous"} - Error:`, e.error);
      }
    }

    return NextResponse.json({ ok: true, ingested: events.length });
  } catch (error) {
    console.error("[mobile-logs-ingestion] Failed to write logs:", error);
    return NextResponse.json({ ok: false, error: "Failed to persist logs." }, { status: 500 });
  }
}
