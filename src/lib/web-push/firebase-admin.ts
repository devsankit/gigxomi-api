import "server-only";

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

type ServiceAccountShape = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

let firebaseAdminError = "";

function decodeMaybeBase64(value: string) {
  const raw = value.trim();
  if (!raw || raw.includes("{") || raw.includes("-----BEGIN")) {
    return raw;
  }

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    return decoded.includes("{") || decoded.includes("-----BEGIN") ? decoded : raw;
  } catch {
    return raw;
  }
}

function canonicalizePem(value: string) {
  const begin = "-----BEGIN PRIVATE KEY-----";
  const end = "-----END PRIVATE KEY-----";
  const beginIndex = value.indexOf(begin);
  const endIndex = value.indexOf(end);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    return value;
  }

  const bodyStart = beginIndex + begin.length;
  const body = value
    .slice(bodyStart, endIndex)
    .replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];

  return `${begin}\n${lines.join("\n")}\n${end}`;
}

function normalizePrivateKey(value: string | undefined) {
  let key = value?.trim() ?? "";
  if (!key) {
    return "";
  }

  try {
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      key = JSON.parse(key) as string;
    }
  } catch {
    key = key.slice(1, -1);
  }

  key = decodeMaybeBase64(key).replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
  key = canonicalizePem(key);
  return key;
}

function parseServiceAccountJson(rawValue: string) {
  const candidates = [rawValue.trim(), decodeMaybeBase64(rawValue)];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as ServiceAccountShape;
    } catch {
      // Try the next common encoding style.
    }
  }

  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON or base64 JSON.");
}

function readServiceAccountFromEnv() {
  firebaseAdminError = "";
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim() ?? "";
  if (serviceAccountPath) {
    try {
      const raw = readFileSync(serviceAccountPath, "utf8");
      const parsed = JSON.parse(raw) as ServiceAccountShape;
      return {
        projectId: parsed.project_id?.trim() ?? "",
        clientEmail: parsed.client_email?.trim() ?? "",
        privateKey: normalizePrivateKey(parsed.private_key),
      };
    } catch (error) {
      firebaseAdminError = error instanceof Error ? error.message : String(error);
    }
  }

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (rawJson) {
    try {
      const parsed = parseServiceAccountJson(rawJson);
      return {
        projectId: parsed.project_id?.trim() ?? "",
        clientEmail: parsed.client_email?.trim() ?? "",
        privateKey: normalizePrivateKey(parsed.private_key),
      };
    } catch (error) {
      firebaseAdminError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() ?? "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim() ?? "",
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  };
}

function getFirebaseAdminApp(): App | null {
  let existing: App | undefined;
  try {
    existing = getApps()[0];
    if (existing) {
      return existing;
    }
  } catch (error) {
    firebaseAdminError = error instanceof Error ? error.message : String(error);
    return null;
  }

  const creds = readServiceAccountFromEnv();
  if (!creds.projectId || !creds.clientEmail || !creds.privateKey) {
    return null;
  }

  if (!creds.privateKey.includes("-----BEGIN PRIVATE KEY-----") || !creds.privateKey.includes("-----END PRIVATE KEY-----")) {
    firebaseAdminError = "Firebase private key is not a PEM private key.";
    return null;
  }

  try {
    firebaseAdminError = "";
    return initializeApp({
      credential: cert({
        projectId: creds.projectId,
        clientEmail: creds.clientEmail,
        privateKey: creds.privateKey,
      }),
    });
  } catch (error) {
    firebaseAdminError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

export function getFirebaseAdminMessaging(): Messaging | null {
  try {
    const app = getFirebaseAdminApp();
    if (!app) {
      return null;
    }
    return getMessaging(app);
  } catch (error) {
    firebaseAdminError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

export function getFirebaseAdminError() {
  return firebaseAdminError;
}
