import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { getFreelancerWorkspaceState } from "@/lib/gigxomi/freelancer-workspace-store";
import { calculateFreelancerTrustScore, ensureFreelancerOnboarding, hashOauthValue } from "@/lib/gigxomi/freelancer-onboarding-service";
import { hasDigiLockerProviderConfiguration } from "@/lib/gigxomi/digilocker-config";
import { prisma } from "@/lib/prisma";

function env(name: string) { return process.env[name]?.trim() ?? ""; }

function config() {
  if (!hasDigiLockerProviderConfiguration()) return null;
  const clientId = env("DIGILOCKER_CLIENT_ID");
  const clientSecret = env("DIGILOCKER_CLIENT_SECRET");
  const authorizeUrl = env("DIGILOCKER_AUTHORIZE_URL");
  const tokenUrl = env("DIGILOCKER_TOKEN_URL");
  const userInfoUrl = env("DIGILOCKER_USERINFO_URL");
  const documentsUrl = env("DIGILOCKER_DOCUMENTS_URL");
  const redirectUri = env("DIGILOCKER_REDIRECT_URI");
  const issuer = env("DIGILOCKER_ISSUER");
  const jwksUrl = env("DIGILOCKER_JWKS_URL");
  const requireIdToken = env("DIGILOCKER_REQUIRE_ID_TOKEN").toLowerCase() === "true";
  return { clientId, clientSecret, authorizeUrl, tokenUrl, userInfoUrl, documentsUrl, redirectUri, issuer, jwksUrl, requireIdToken };
}

export function isDigiLockerConfigured() {
  return config() !== null;
}

export function getAllowedDigiLockerDocumentTypes() {
  const configured = env("DIGILOCKER_ALLOWED_DOCUMENT_TYPES").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  return configured.length ? configured : ["PAN", "DRIVING_LICENCE", "VOTER_ID"];
}

const documentTypeAliases: Record<string, string[]> = {
  PAN: ["PAN", "PANCR"],
  DRIVING_LICENCE: ["DRIVING_LICENCE", "DRIVING_LICENSE", "DRVLC"],
  VOTER_ID: ["VOTER_ID", "VOTID", "EPIC"],
};

function scopeFor(documentType: string) {
  let mapping: Record<string, string> = {};
  try { mapping = JSON.parse(env("DIGILOCKER_DOCUMENT_SCOPES_JSON") || "{}") as Record<string, string>; } catch { mapping = {}; }
  return [env("DIGILOCKER_BASE_SCOPES") || "openid profile", mapping[documentType]].filter(Boolean).join(" ");
}

function normalizeName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function unwrapPayload(payload: Record<string, unknown>) {
  return payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : payload;
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function beginDigiLockerAuthorization(userId: string, documentTypeInput: unknown, returnTargetInput?: unknown) {
  const provider = config();
  if (!provider) return { ok: false as const, status: 503, error: "DigiLocker deployment configuration is incomplete." };
  const documentType = String(documentTypeInput ?? "").trim().toUpperCase();
  if (!getAllowedDigiLockerDocumentTypes().includes(documentType)) return { ok: false as const, status: 400, error: "Choose a supported government document." };
  const state = `${randomBytes(32).toString("base64url")}${String(returnTargetInput ?? "").toLowerCase() === "mobile" ? ".mobile" : ""}`;
  const nonce = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.appFreelancerIdentity.upsert({
    where: { userId },
    create: { userId, status: "AUTHORIZING", requestedDocumentType: documentType, oauthStateHash: hashOauthValue(state), oauthNonceHash: hashOauthValue(nonce), oauthCodeVerifier: verifier, oauthExpiresAt: expiresAt },
    update: { status: "AUTHORIZING", requestedDocumentType: documentType, oauthStateHash: hashOauthValue(state), oauthNonceHash: hashOauthValue(nonce), oauthCodeVerifier: verifier, oauthExpiresAt: expiresAt, consentedAt: null, skippedAt: null, revokedAt: null, lastError: null },
  });
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", provider.redirectUri);
  url.searchParams.set("scope", scopeFor(documentType));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { ok: true as const, authorizeUrl: url.toString(), expiresAt: expiresAt.toISOString() };
}

async function providerGet(url: string, accessToken: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`DigiLocker returned ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

function findDocument(payload: Record<string, unknown>, requested: string) {
  const normalizedPayload = unwrapPayload(payload);
  const acceptedTypes = new Set((documentTypeAliases[requested] ?? [requested]).map((item) => item.toUpperCase()));
  const candidates = [normalizedPayload.items, normalizedPayload.documents, normalizedPayload.issued_documents, normalizedPayload.issuedDocuments].find(Array.isArray) as Array<Record<string, unknown>> | undefined;
  if (!candidates) {
    const directType = readString(normalizedPayload, ["document_type", "documentType", "doctype"]).toUpperCase();
    const issuer = readString(normalizedPayload, ["issuer", "issuer_name", "issuerName"]);
    const uri = readString(normalizedPayload, ["uri", "document_uri", "documentUri"]);
    return acceptedTypes.has(directType) && issuer && uri ? { type: directType, issuer } : null;
  }
  return candidates
    .map((item) => ({
      type: readString(item, ["document_type", "documentType", "doctype"]).toUpperCase(),
      issuer: readString(item, ["issuer", "issuer_name", "issuerName"]),
      uri: readString(item, ["uri", "document_uri", "documentUri"]),
    }))
    .find((item) => acceptedTypes.has(item.type) && item.issuer && item.uri) ?? null;
}

export async function completeDigiLockerAuthorization(code: string, state: string) {
  const provider = config();
  if (!provider) return { ok: false as const, error: "DigiLocker deployment configuration is incomplete." };
  const identity = await prisma.appFreelancerIdentity.findFirst({ where: { oauthStateHash: hashOauthValue(state), status: "AUTHORIZING" } });
  if (!identity) return { ok: false as const, error: "DigiLocker authorization state validation failed." };
  if (!identity.oauthExpiresAt || identity.oauthExpiresAt < new Date()) {
    await prisma.appFreelancerIdentity.update({
      where: { userId: identity.userId },
      data: { status: "FAILED", lastError: "DigiLocker authorization expired.", oauthStateHash: null, oauthNonceHash: null, oauthCodeVerifier: null, oauthExpiresAt: null },
    });
    return { ok: false as const, userId: identity.userId, error: "DigiLocker authorization expired." };
  }
  const consumed = await prisma.appFreelancerIdentity.updateMany({
    where: { userId: identity.userId, status: "AUTHORIZING", oauthStateHash: hashOauthValue(state), oauthExpiresAt: { gt: new Date() } },
    data: { status: "VERIFYING", oauthStateHash: null },
  });
  if (consumed.count !== 1) return { ok: false as const, error: "DigiLocker authorization has already been used." };
  try {
    const tokenResponse = await fetch(provider.tokenUrl, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: provider.redirectUri, client_id: provider.clientId, client_secret: provider.clientSecret, code_verifier: identity.oauthCodeVerifier ?? "" }),
      cache: "no-store",
    });
    if (!tokenResponse.ok) throw new Error(`DigiLocker token exchange returned ${tokenResponse.status}.`);
    const tokenPayload = unwrapPayload((await tokenResponse.json()) as Record<string, unknown>);
    const accessToken = readString(tokenPayload, ["access_token"]);
    const idToken = readString(tokenPayload, ["id_token"]);
    if (!accessToken) throw new Error("DigiLocker did not return an access token.");
    let tokenSubject = "";
    if (idToken) {
      if (!provider.issuer || !provider.jwksUrl) throw new Error("DigiLocker returned an identity token but OIDC verification is not configured.");
      const verifiedToken = await jwtVerify(idToken, createRemoteJWKSet(new URL(provider.jwksUrl)), { issuer: provider.issuer, audience: provider.clientId });
      const returnedNonce = typeof verifiedToken.payload.nonce === "string" ? verifiedToken.payload.nonce : "";
      if (!returnedNonce || !identity.oauthNonceHash || hashOauthValue(returnedNonce) !== identity.oauthNonceHash) throw new Error("DigiLocker nonce validation failed.");
      tokenSubject = typeof verifiedToken.payload.sub === "string" ? verifiedToken.payload.sub : "";
    } else if (provider.requireIdToken) {
      throw new Error("DigiLocker did not return the required signed identity token.");
    }
    const userInfo = unwrapPayload(await providerGet(provider.userInfoUrl, accessToken));
    const documents = provider.documentsUrl ? await providerGet(provider.documentsUrl, accessToken) : userInfo;
    const requested = identity.requestedDocumentType ?? "";
    const document = findDocument(documents, requested);
    if (!document) throw new Error("The selected government document was not returned with consent.");
    const verifiedName = readString(userInfo, ["name", "full_name", "fullName"]);
    const userInfoSubject = readString(userInfo, ["sub", "id", "digilockerid"]);
    if (tokenSubject && userInfoSubject && userInfoSubject !== tokenSubject) throw new Error("DigiLocker subject validation failed.");
    const providerSubject = tokenSubject || userInfoSubject;
    if (!providerSubject) throw new Error("DigiLocker did not return an account reference.");
    const user = await prisma.appAuthUser.findUnique({ where: { id: identity.userId } });
    const workspace = await getFreelancerWorkspaceState(identity.userId, { userId: identity.userId, displayName: user?.displayName ?? null, email: user?.email ?? null, phone: user?.phone ?? null });
    if (!verifiedName || normalizeName(verifiedName) !== normalizeName(workspace.profile.fullName)) throw new Error("Your DigiLocker name does not match the full name in your Gigxomi profile.");
    await prisma.appFreelancerIdentity.update({
      where: { userId: identity.userId },
      data: { status: "VERIFIED", providerSubject, documentType: document.type, issuer: document.issuer, verifiedName, consentedAt: new Date(), verifiedAt: new Date(), oauthStateHash: null, oauthNonceHash: null, oauthCodeVerifier: null, oauthExpiresAt: null, lastError: null },
    });
    const session = { userId: identity.userId, role: "FREELANCER" as const, displayName: user?.displayName ?? "Freelancer", email: user?.email ?? null, phone: user?.phone ?? "" };
    await ensureFreelancerOnboarding(session);
    await calculateFreelancerTrustScore(identity.userId);
    return { ok: true as const, userId: identity.userId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "DigiLocker verification failed.";
    await prisma.appFreelancerIdentity.update({ where: { userId: identity.userId }, data: { status: "FAILED", lastError: message, oauthStateHash: null, oauthNonceHash: null, oauthCodeVerifier: null, oauthExpiresAt: null } });
    return { ok: false as const, userId: identity.userId, error: message };
  }
}

export async function failDigiLockerAuthorization(state: string, reason: string) {
  if (!state.trim()) return { ok: false as const, error: "DigiLocker callback state was missing." };
  const identity = await prisma.appFreelancerIdentity.findFirst({
    where: { oauthStateHash: hashOauthValue(state), status: "AUTHORIZING" },
  });
  if (!identity) return { ok: false as const, error: "DigiLocker authorization state validation failed." };
  await prisma.appFreelancerIdentity.update({
    where: { userId: identity.userId },
    data: {
      status: "FAILED",
      lastError: reason.trim() || "DigiLocker authorization was cancelled.",
      oauthStateHash: null,
      oauthNonceHash: null,
      oauthCodeVerifier: null,
      oauthExpiresAt: null,
    },
  });
  return { ok: true as const, userId: identity.userId };
}

export async function revokeDigiLockerVerification(userId: string) {
  await prisma.appFreelancerIdentity.upsert({
    where: { userId }, create: { userId, status: "REVOKED", revokedAt: new Date() },
    update: { status: "REVOKED", providerSubject: null, documentType: null, issuer: null, verifiedName: null, verifiedAt: null, revokedAt: new Date(), oauthStateHash: null, oauthNonceHash: null, oauthCodeVerifier: null, oauthExpiresAt: null },
  });
  await calculateFreelancerTrustScore(userId);
}
