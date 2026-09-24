import fs from "node:fs";
import path from "node:path";

export type StoredPushToken = {
  userId: string;
  token: string;
  platform: "ios" | "android";
  createdAt: string;
  updatedAt: string;
};

const STORAGE_FILE = path.join(process.cwd(), ".data", "push-tokens.json");

function ensureStorageDir() {
  const dir = path.dirname(STORAGE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readAllTokens(): StoredPushToken[] {
  try {
    ensureStorageDir();
    if (!fs.existsSync(STORAGE_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(STORAGE_FILE, "utf8");
    return JSON.parse(raw) as StoredPushToken[];
  } catch {
    return [];
  }
}

function writeAllTokens(tokens: StoredPushToken[]) {
  try {
    ensureStorageDir();
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(tokens, null, 2), "utf8");
  } catch (error) {
    console.error("[push-token-store] Failed to save push tokens to file:", error);
  }
}

export async function saveUserPushToken(input: {
  userId: string;
  token: string;
  platform: "ios" | "android";
}): Promise<StoredPushToken> {
  const tokens = readAllTokens();
  const existingIndex = tokens.findIndex((t) => t.token === input.token);
  const now = new Date().toISOString();

  const record: StoredPushToken = {
    userId: input.userId,
    token: input.token,
    platform: input.platform,
    createdAt: existingIndex >= 0 ? tokens[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    tokens[existingIndex] = record;
  } else {
    tokens.push(record);
  }

  writeAllTokens(tokens);
  return record;
}

export async function removeUserPushToken(input: {
  userId: string;
  token: string;
}): Promise<boolean> {
  const tokens = readAllTokens();
  const filtered = tokens.filter(
    (t) => !(t.token === input.token && t.userId === input.userId)
  );

  if (filtered.length !== tokens.length) {
    writeAllTokens(filtered);
    return true;
  }
  return false;
}

export async function getUserPushTokens(userId: string): Promise<StoredPushToken[]> {
  const tokens = readAllTokens();
  return tokens.filter((t) => t.userId === userId);
}

export type SendPushOptions = {
  to: string | string[];
  title: string;
  message: string;
  deepLinkUrl?: string;
  data?: Record<string, unknown>;
};

export async function sendExpoPushNotification(options: SendPushOptions) {
  const recipients = Array.isArray(options.to) ? options.to : [options.to];
  const validTokens = recipients.filter(
    (t) => typeof t === "string" && (t.startsWith("ExponentPushToken") || t.startsWith("ExpoPushToken"))
  );

  if (!validTokens.length) {
    return {
      ok: false,
      sentCount: 0,
      error: "No valid Expo push tokens provided.",
    };
  }

  const messages = validTokens.map((token) => ({
    to: token,
    sound: "default",
    title: options.title,
    body: options.message,
    data: {
      ...options.data,
      deepLinkUrl: options.deepLinkUrl ?? "/notifications",
    },
  }));

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    const payload = (await response.json()) as unknown;
    return {
      ok: response.ok,
      sentCount: validTokens.length,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      sentCount: 0,
      error: error instanceof Error ? error.message : "Failed to send Expo push notification.",
    };
  }
}
