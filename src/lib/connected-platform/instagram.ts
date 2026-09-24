import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { encryptConnectedSecret } from "@/lib/connected-platform/secret-box";

const GRAPH_VERSION = "v25.0";

type InstagramState = { userId: string; expiresAt: number };

function stateSecret() {
  const value = process.env.CONNECTED_PLATFORM_OAUTH_STATE_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!value) throw new Error("CONNECTED_PLATFORM_OAUTH_STATE_SECRET is required for Instagram connection.");
  return value;
}

function encodeState(payload: InstagramState) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function decodeState(value: string): InstagramState {
  const [body, signature] = value.split(".");
  if (!body || !signature) throw new Error("Instagram connection state is invalid.");
  const expected = createHmac("sha256", stateSecret()).update(body).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("Instagram connection state did not match.");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as InstagramState;
  if (!payload.userId || payload.expiresAt <= Date.now()) throw new Error("Instagram connection state expired.");
  return payload;
}

function oauthConfig() {
  const appId = process.env.INSTAGRAM_OAUTH_CLIENT_ID?.trim() || process.env.NEXT_PUBLIC_INSTAGRAM_OAUTH_CLIENT_ID?.trim();
  const appSecret = process.env.INSTAGRAM_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.CONNECTED_INSTAGRAM_REDIRECT_URI?.trim();
  if (!appId || !appSecret || !redirectUri) throw new Error("Instagram Business Login is not fully configured.");
  return { appId, appSecret, redirectUri };
}

export function createInstagramBusinessLoginUrl(userId: string) {
  const { appId, redirectUri } = oauthConfig();
  const state = encodeState({ userId, expiresAt: Date.now() + 15 * 60 * 1000 });
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_messages");
  return url.toString();
}

async function graphJson<T>(url: URL, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "Meta Graph request failed.");
  return payload;
}

export async function completeInstagramBusinessLogin(input: { code: string; state: string }) {
  const signedState = decodeState(input.state);
  const { appId, appSecret, redirectUri } = oauthConfig();
  const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", input.code);
  const token = await graphJson<{ access_token: string; expires_in?: number }>(tokenUrl);

  const accountsUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
  accountsUrl.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username,name}");
  accountsUrl.searchParams.set("access_token", token.access_token);
  const accounts = await graphJson<{
    data?: Array<{ id: string; name?: string; access_token?: string; instagram_business_account?: { id: string; username?: string; name?: string } }>;
  }>(accountsUrl);
  const page = accounts.data?.find((item) => item.instagram_business_account?.id && item.access_token);
  if (!page?.instagram_business_account?.id || !page.access_token) throw new Error("No connected Instagram Business account was returned by Meta.");

  const subscribeUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${page.id}/subscribed_apps`);
  subscribeUrl.searchParams.set("subscribed_fields", "messages,messaging_postbacks,comments");
  subscribeUrl.searchParams.set("access_token", page.access_token);
  await graphJson<{ success?: boolean }>(subscribeUrl, { method: "POST" });

  const connection = await prisma.appSocialConnection.upsert({
    where: { userId_provider: { userId: signedState.userId, provider: "INSTAGRAM" } },
    create: {
      userId: signedState.userId,
      provider: "INSTAGRAM",
      status: "CONNECTED",
      externalAccountId: page.instagram_business_account.id,
      displayName: page.instagram_business_account.username || page.instagram_business_account.name || page.name || null,
      accessTokenCiphertext: encryptConnectedSecret(page.access_token),
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      webhookSubscribedAt: new Date(),
      metadata: { pageId: page.id, pageName: page.name || "" },
    },
    update: {
      status: "CONNECTED",
      externalAccountId: page.instagram_business_account.id,
      displayName: page.instagram_business_account.username || page.instagram_business_account.name || page.name || null,
      accessTokenCiphertext: encryptConnectedSecret(page.access_token),
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      webhookSubscribedAt: new Date(),
      lastError: null,
      metadata: { pageId: page.id, pageName: page.name || "" },
    },
  });
  const whatsapp = await prisma.appSocialConnection.findUnique({ where: { userId_provider: { userId: signedState.userId, provider: "WHATSAPP" } }, select: { status: true } });
  await prisma.connectedOnboardingState.updateMany({
    where: { userId: signedState.userId, audience: "AGENCY" },
    data: whatsapp?.status === "CONNECTED" ? { stage: "COMPLETE", completedAt: new Date() } : { stage: "WHATSAPP" },
  });
  return connection;
}
