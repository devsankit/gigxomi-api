import { NextResponse } from "next/server";

import { getFreelancerConversationAccess } from "@/lib/api/conversation-access";
import { resolveSessionTenantId, resolveWhatsAppSetupTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  getConversationByIdFromFile,
  getWhatsAppConnectionStateFromFile,
  updateConversationCustomerProfileFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";

type SessionAuthorization = Awaited<ReturnType<typeof requireSessionRole>> & {
  ok: true;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeGraphVersion(value: unknown) {
  const raw = text(value);
  if (!raw) {
    return "v25.0";
  }

  const normalized = raw.startsWith("v") ? raw : `v${raw}`;
  return /^v\d+\.\d+$/i.test(normalized) ? normalized : "v25.0";
}

function normalizePhoneCandidates(value: unknown) {
  const raw = text(value);
  if (!raw) {
    return [];
  }

  const digitsOnly = raw.replace(/[^\d]/g, "");
  const withPlus = digitsOnly ? `+${digitsOnly}` : "";
  return Array.from(new Set([raw, withPlus, digitsOnly].map((item) => item.trim()).filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dataArray(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value) && Array.isArray(value.data)) {
    return value.data;
  }
  return [];
}

function contactArray(value: unknown) {
  if (isRecord(value) && Array.isArray(value.contacts)) {
    return value.contacts;
  }
  return dataArray(value);
}

function extractImageUrl(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^(https?:\/\/|\/|data:image\/)/i.test(trimmed) ? trimmed : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractImageUrl(item);
      if (nested) {
        return nested;
      }
    }
    return "";
  }

  if (!isRecord(value)) {
    return "";
  }

  const directCandidates = [
    value.url,
    value.href,
    value.uri,
    value.src,
    value.source,
    value.profile_picture_url,
    value.profileImageUrl,
    value.picture_url,
  ];

  for (const candidate of directCandidates) {
    const directUrl = extractImageUrl(candidate);
    if (directUrl) {
      return directUrl;
    }
  }

  const nestedCandidates = [
    value.data,
    value.picture,
    value.profile_picture,
    value.profile,
    value.image,
    value.images,
    value.result,
    value.results,
  ];

  for (const candidate of nestedCandidates) {
    const nestedUrl = extractImageUrl(candidate);
    if (nestedUrl) {
      return nestedUrl;
    }
  }

  return "";
}

async function fetchMetaPayload(input: {
  accessToken: string;
  graphApiVersion: string;
  path: string;
  method?: "GET" | "POST";
  body?: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(new URL(`https://graph.facebook.com/${input.graphApiVersion}/${input.path}`), {
      method: input.method ?? "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : null;

    return {
      ok: response.ok,
      payload,
      resolvedUrl: response.url,
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveWhatsAppContactWaId(input: {
  accessToken: string;
  graphApiVersion: string;
  phoneNumberId: string;
  customerPhone: string;
}) {
  const contactPhones = normalizePhoneCandidates(input.customerPhone);
  if (!contactPhones.length) {
    return "";
  }

  const postAttempt = await fetchMetaPayload({
    accessToken: input.accessToken,
    graphApiVersion: input.graphApiVersion,
    path: `${input.phoneNumberId}/contacts`,
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      blocking: "wait",
      force_check: true,
      contacts: contactPhones,
    }),
  }).catch(() => null);

  const postContacts = contactArray(postAttempt?.payload);
  const postFirst = postContacts.find((item) => isRecord(item)) as Record<string, unknown> | undefined;
  const postWaId = text(postFirst?.wa_id ?? postFirst?.id);
  if (postWaId) {
    return postWaId;
  }

  const query = new URLSearchParams({
    blocking: "wait",
    force_check: "true",
    contacts: JSON.stringify(contactPhones),
  });
  const getAttempt = await fetchMetaPayload({
    accessToken: input.accessToken,
    graphApiVersion: input.graphApiVersion,
    path: `${input.phoneNumberId}/contacts?${query.toString()}`,
  }).catch(() => null);

  const getContacts = contactArray(getAttempt?.payload);
  const getFirst = getContacts.find((item) => isRecord(item)) as Record<string, unknown> | undefined;
  return text(getFirst?.wa_id ?? getFirst?.id);
}
async function resolveWhatsAppProfilePictureByWaId(input: {
  accessToken: string;
  graphApiVersion: string;
  waId: string;
}) {
  const waId = text(input.waId);
  if (!waId) {
    return "";
  }

  const attempts = [
    `${waId}/profile_picture?type=large`,
    `${waId}/picture?redirect=0&type=large`,
    `${waId}?fields=profile_picture_url,picture{url},profile_picture{url}`,
  ];

  for (const path of attempts) {
    const result = await fetchMetaPayload({
      accessToken: input.accessToken,
      graphApiVersion: input.graphApiVersion,
      path,
    }).catch(() => null);

    const imageUrl = extractImageUrl(result?.payload);
    if (imageUrl) {
      return imageUrl;
    }

    const resolvedUrl = text(result?.resolvedUrl);
    if (result?.ok && resolvedUrl && !resolvedUrl.includes(`graph.facebook.com/${input.graphApiVersion}/`)) {
      return resolvedUrl;
    }
  }

  return "";
}

async function resolveWhatsAppProfilePictureUrl(input: {
  accessToken: string;
  graphApiVersion: string;
  phoneNumberId: string;
  customerPhone: string;
}) {
  const candidateWaIds = normalizePhoneCandidates(input.customerPhone);
  for (const waId of candidateWaIds) {
    const imageUrl = await resolveWhatsAppProfilePictureByWaId({
      accessToken: input.accessToken,
      graphApiVersion: input.graphApiVersion,
      waId,
    });
    if (imageUrl) {
      return imageUrl;
    }
  }

  const waId = await resolveWhatsAppContactWaId(input);
  if (!waId) {
    return "";
  }

  return resolveWhatsAppProfilePictureByWaId({
    accessToken: input.accessToken,
    graphApiVersion: input.graphApiVersion,
    waId,
  });
}

function shouldProxyMetaProfileImage(imageUrl: string) {
  try {
    const parsed = new URL(imageUrl);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "graph.facebook.com" ||
      host.endsWith(".facebook.com") ||
      host.endsWith(".whatsapp.net") ||
      host.endsWith(".fbcdn.net")
    );
  } catch {
    return false;
  }
}

async function fetchMetaProfileImageDataUri(input: {
  imageUrl: string;
  accessToken: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const attempts = shouldProxyMetaProfileImage(input.imageUrl) ? [true, false] : [false, true];

    for (const useAuth of attempts) {
      const response = await fetch(input.imageUrl, {
        cache: "no-store",
        signal: controller.signal,
        headers: useAuth ? { Authorization: `Bearer ${input.accessToken}` } : undefined,
      }).catch(() => null);

      if (!response?.ok) {
        continue;
      }

      const contentType = text(response.headers.get("content-type"));
      if (!contentType.toLowerCase().startsWith("image/")) {
        continue;
      }

      const arrayBuffer = await response.arrayBuffer().catch(() => null);
      if (!arrayBuffer || arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > 1024 * 1024) {
        continue;
      }

      const base64 = Buffer.from(arrayBuffer).toString("base64");
      if (!base64) {
        continue;
      }

      return `data:${contentType};base64,${base64}`;
    }
  } finally {
    clearTimeout(timeout);
  }

  return "";
}

async function resolvePersistableProfileImage(input: {
  imageUrl: string;
  accessToken: string;
}) {
  const imageUrl = text(input.imageUrl);
  if (!imageUrl) {
    return "";
  }

  if (/^data:image\//i.test(imageUrl)) {
    return imageUrl;
  }

  const dataUri = await fetchMetaProfileImageDataUri({
    imageUrl,
    accessToken: input.accessToken,
  }).catch(() => "");

  if (dataUri) {
    return dataUri;
  }

  return shouldProxyMetaProfileImage(imageUrl) ? "" : imageUrl;
}

async function resolveConversationForRequest(authorization: SessionAuthorization, id: string) {
  const conversation = await getConversationByIdFromFile(id);
  if (!conversation) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 }),
    };
  }

  if (authorization.session.role === "FREELANCER") {
    const access = await getFreelancerConversationAccess(authorization.session, id);
    if (!access.ok) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { ok: false, error: access.reason === "missing" ? "Conversation not found." : "You do not have access to this conversation." },
          { status: access.reason === "missing" ? 404 : 403 },
        ),
      };
    }
  } else if (authorization.session.role !== "SUPER_ADMIN") {
    const sessionTenantId =
      authorization.session.role === "SALES_AGENT" ? resolveWhatsAppSetupTenantId(authorization.session) : resolveSessionTenantId(authorization.session);
    if (conversation.tenantId !== sessionTenantId) {
      return {
        ok: false as const,
        response: NextResponse.json({ ok: false, error: "You do not have access to this conversation." }, { status: 403 }),
      };
    }
  }

  return { ok: true as const, conversation };
}

async function buildProfilePictureResponse(
  authorization: SessionAuthorization,
  id: string,
  options?: { forceRefresh?: boolean },
) {
  const forceRefresh = options?.forceRefresh === true;
  const resolvedConversation = await resolveConversationForRequest(authorization, id);
  if (!resolvedConversation.ok) {
    return resolvedConversation.response;
  }

  const { conversation } = resolvedConversation;
  const existingImageUrl = text(conversation.customerProfileImageUrl);
  const existingImageNeedsProxyRefresh = Boolean(
    existingImageUrl &&
      !/^data:image\//i.test(existingImageUrl) &&
      shouldProxyMetaProfileImage(existingImageUrl),
  );
  if (existingImageUrl && !forceRefresh && !existingImageNeedsProxyRefresh) {
    return NextResponse.json({
      ok: true,
      conversationId: conversation.id,
      customerProfileImageUrl: existingImageUrl,
      profileImageUrl: existingImageUrl,
      source: "stored",
    });
  }

  const connection = await getWhatsAppConnectionStateFromFile(conversation.tenantId);
  const accessToken = text(connection?.accessToken);
  const phoneNumberId = text(connection?.phoneNumberId);
  if (!accessToken || !phoneNumberId) {
    return NextResponse.json(
      {
        ok: false,
        error: "WhatsApp Cloud API is not connected for this tenant yet.",
      },
      { status: 409 },
    );
  }

  const customerProfileImageUrl = await resolveWhatsAppProfilePictureUrl({
    accessToken,
    graphApiVersion: normalizeGraphVersion(connection?.graphApiVersion),
    phoneNumberId,
    customerPhone: conversation.customerPhone,
  }).catch(() => "");

  if (!customerProfileImageUrl) {
    if (existingImageUrl) {
      return NextResponse.json({
        ok: true,
        conversationId: conversation.id,
        customerProfileImageUrl: existingImageUrl,
        profileImageUrl: existingImageUrl,
        source: "stored",
        stale: true,
      });
    }

    return NextResponse.json({
      ok: true,
      conversationId: conversation.id,
      customerProfileImageUrl: existingImageUrl || "",
      profileImageUrl: existingImageUrl || "",
      source: "unavailable",
      unavailable: true,
    });
  }

  const persistableProfileImageUrl = await resolvePersistableProfileImage({
    imageUrl: customerProfileImageUrl,
    accessToken,
  }).catch(() => "");

  if (!persistableProfileImageUrl) {
    if (existingImageUrl) {
      return NextResponse.json({
        ok: true,
        conversationId: conversation.id,
        customerProfileImageUrl: existingImageUrl,
        profileImageUrl: existingImageUrl,
        source: "stored",
        stale: true,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "WhatsApp profile photo could not be persisted yet. Please refresh in a moment.",
      },
      { status: 503 },
    );
  }

  await updateConversationCustomerProfileFromFile(conversation.id, {
    customerProfileImageUrl: persistableProfileImageUrl,
  });

  return NextResponse.json({
    ok: true,
    conversationId: conversation.id,
    customerProfileImageUrl: persistableProfileImageUrl,
    profileImageUrl: persistableProfileImageUrl,
    source: "meta",
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const requestUrl = new URL(_request.url);
  const refreshParam = text(requestUrl.searchParams.get("refresh"));
  const forceRefresh = refreshParam === "1" || refreshParam.toLowerCase() === "true";
  const { id } = await context.params;
  return buildProfilePictureResponse(authorization as SessionAuthorization, id, { forceRefresh });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  return buildProfilePictureResponse(authorization as SessionAuthorization, id, { forceRefresh: true });
}

