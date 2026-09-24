import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";

import {
  appendConversationMessage,
  addConversationFreelancerCollaborators,
  approveProjectIntakeAndOffer,
  assignConversation,
  assignConversationDirectly,
  createConversationPaymentRequest,
  createContact,
  createCustomerConversation,
  createManagerAccount,
  createManualConversation,
  deliverConversationMessage,
  deleteConversationMessageForEveryone,
  expireStaleConversationOffers,
  getConversationById,
  ensureInstagramConnectionDraft,
  findInstagramConnectionStateByVerifyToken,
  findWhatsAppConnectionStateByVerifyToken,
  getCustomerPrivacySettings,
  getDummyPlatformSnapshot,
  getInstagramConnectionState,
  getManagerById,
  getPublicCatalogStats,
  getServiceById,
  getServiceBySlug,
  getUpiConfig,
  getWhatsAppConnectionState,
  getYouTubeConnectionState,
  hydrateDummyPlatformSnapshot,
  ingestInstagramWebhookPayload,
  ingestWhatsAppWebhookPayload,
  listContacts,
  listConversationTemplates,
  listFreelancerServices,
  listInstagramConnectionStates,
  listLeadStatuses,
  listManagers,
  listPublicServices,
  listWhatsAppConnectionStates,
  listYouTubeUploads,
  listConversationsForAudience,
  manageLeadStatuses,
  markConversationRead,
  reviewService,
  respondToConversationAssignment,
  setEditorProjectAvailability,
  setFreelancerServiceAvailability,
  sendStandaloneInstagramMessage,
  sendStandaloneWhatsAppMessage,
  sendWhatsAppReaction,
  sendStandaloneWhatsAppCtaUrlMessage,
  sendStandaloneWhatsAppCallToActionTemplate,
  sendStandaloneWhatsAppOtpMessage,
  sendConversationReviewFlow,
  sendConversationTypingIndicator,
  setConversationTyping,
  submitServiceForReview,
  updateContact,
  updateCustomerPrivacySettings,
  updateConversationLeadStatus,
  updateConversationPrivacy,
  updateConversationAiAutoReply,
  updateConversationDueDate,
  updateConversationInternalNotes,
  updateConversationCustomerProfile,
  updateConversationCustomerName,
  updateFreelancerCustomerLaneAccess,
  updateFreelancerClientAlias,
  updateManagerPermissions,
  updatePaymentRequestStatus,
  updateUpiConfig,
  upsertFreelancerService,
  type DummyConversationLane,
  type DummyConversationRole,
  type DummyCustomerPrivacySettings,
  type DummyLeadStatusTone,
  type DummyManagerPermissionSet,
  type DummyInstagramConnectionState,
  type DummyPlatformSnapshot,
  type DummyUpiConfig,
  type DummyWhatsAppConnectionState,
  type DummyYouTubeConnectionState,
  updateInstagramConnectionState,
  updateWhatsAppConnectionState,
  updateYouTubeConnectionState,
  unassignConversationEditors,
  listChannelConnections,
  getChannelConnectionById,
  findChannelConnectionForWhatsApp,
  findChannelConnectionForInstagram,
  saveChannelConnection,
  deleteChannelConnection,
  updateChannelConnectionName,
  type ChannelConnection,
  type ChannelConnectionProvider,
  type ChannelConnectionStatus,
} from "@/lib/gigxomi/dummy-platform-store";
import { readPlatformSnapshotFromDb, writePlatformSnapshotToDb } from "@/lib/gigxomi/dummy-platform-db-store";
import { exchangeMetaAuthorizationCode, fetchMetaWhatsAppSetupSummary } from "@/lib/gigxomi/meta-whatsapp-auth";

const STORE_DIRECTORY = path.join(process.cwd(), ".gigxomi");
const STORE_PATH = path.join(STORE_DIRECTORY, "local-platform-store.json");
const SNAPSHOT_CACHE_TTL_MS = 30_000;
const READ_RECEIPT_COOLDOWN_MS = 5 * 60 * 1000;
const TYPING_INDICATOR_COOLDOWN_MS = 8_000;
const META_REFRESH_COOLDOWN_MS = 60_000;

let queue = Promise.resolve();
let snapshotCache: { snapshot: DummyPlatformSnapshot; loadedAt: number } | null = null;
let lastHydratedSnapshot: DummyPlatformSnapshot | null = null;
const recentReadReceiptAttempts = new Map<string, number>();
const recentTypingIndicatorAttempts = new Map<string, number>();
const recentMetaRefreshAttempts = new Map<string, number>();

type UpsertFreelancerServiceInput = Parameters<typeof upsertFreelancerService>[0];
type ReviewFreelancerServiceAction = Parameters<typeof reviewService>[1];

function hasDatabaseSnapshotStore() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

async function readSnapshotFromDisk() {
  try {
    const contents = await readFile(STORE_PATH, "utf8");
    return JSON.parse(contents) as DummyPlatformSnapshot;
  } catch {
    return getDummyPlatformSnapshot();
  }
}

async function writeSnapshotToDisk(snapshot: DummyPlatformSnapshot) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
}

function resolveMetaCallbackUrl(publicBaseUrl: string) {
  if (!publicBaseUrl.trim()) {
    return "";
  }

  try {
    return new URL("/meta/whatsapp/callback", publicBaseUrl).toString();
  } catch {
    return "";
  }
}

function shouldRetrySuspiciousWhatsAppSend(error?: string | null) {
  const normalized = String(error ?? "").toLowerCase();
  return normalized.includes("unsupported post request") || normalized.includes("does not support this operation");
}

function hasSuspiciousPhoneNumberId(connection: Pick<DummyWhatsAppConnectionState, "phoneNumberId" | "wabaId" | "businessId" | "businessPortfolioId"> | null | undefined) {
  const phoneNumberId = String(connection?.phoneNumberId ?? "").trim();
  if (!phoneNumberId) {
    return false;
  }

  const references = [connection?.wabaId, connection?.businessId, connection?.businessPortfolioId]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return references.includes(phoneNumberId);
}

function shouldRefreshWhatsAppBeforeSend(connection: DummyWhatsAppConnectionState | null | undefined) {
  if (!connection) {
    return false;
  }

  const accessToken = String(connection.accessToken ?? "").trim();
  const authorizationCode = String(connection.authorizationCode ?? "").trim();
  const metaAppId = String(connection.metaAppId ?? "").trim();
  const phoneNumberId = String(connection.phoneNumberId ?? "").trim();
  const lastError = String(connection.lastError ?? "").toLowerCase();
  const hasConfiguredSendIdentity = Boolean(accessToken && phoneNumberId && !hasSuspiciousPhoneNumberId(connection));

  if (hasSuspiciousPhoneNumberId(connection)) {
    return true;
  }

  if (hasConfiguredSendIdentity) {
    return false;
  }

  if (!accessToken && authorizationCode && metaAppId) {
    return true;
  }

  // A token can discover its WABA and phone identity from Meta even when the
  // saved record has neither value (for example after an Embedded Signup
  // callback missed the phone-number ID). Do not wait for a partial WABA
  // record before attempting that recovery.
  if (accessToken && !phoneNumberId) {
    return true;
  }

  if (lastError.includes("unsupported post request") || lastError.includes("does not support this operation")) {
    return true;
  }

  if (lastError.includes("error validating access token") || lastError.includes("authorization needs attention")) {
    return true;
  }

  return false;
}

function isInstagramConversation(conversation: { customerId?: string; serviceId?: string; sourceChannel?: string } | null | undefined) {
  return (
    conversation?.sourceChannel === "instagram" ||
    conversation?.serviceId === "svc-instagram-inbox" ||
    String(conversation?.customerId ?? "").startsWith("ig-")
  );
}

function pruneReadReceiptAttempts(now = Date.now()) {
  for (const [key, expiresAt] of recentReadReceiptAttempts) {
    if (expiresAt <= now) {
      recentReadReceiptAttempts.delete(key);
    }
  }
}

function shouldSendTypingIndicatorNow(key: string, active: boolean, now = Date.now()) {
  if (!active) {
    recentTypingIndicatorAttempts.delete(key);
    return false;
  }

  for (const [entryKey, expiresAt] of recentTypingIndicatorAttempts) {
    if (expiresAt <= now) {
      recentTypingIndicatorAttempts.delete(entryKey);
    }
  }

  const expiresAt = recentTypingIndicatorAttempts.get(key) ?? 0;
  if (expiresAt > now) {
    return false;
  }

  recentTypingIndicatorAttempts.set(key, now + TYPING_INDICATOR_COOLDOWN_MS);
  return true;
}

function createWhatsAppReadReceiptTarget(
  conversationId: string,
  audience: DummyConversationRole,
  lane?: DummyConversationLane,
) {
  if (audience === "customer" || (lane && lane !== "customer")) {
    return null;
  }

  const conversation = getConversationById(conversationId);
  if (!conversation) {
    return null;
  }

  const connection = getWhatsAppConnectionState(conversation.tenantId);
  const accessToken = connection?.accessToken?.trim() ?? "";
  const phoneNumberId = connection?.phoneNumberId?.trim() ?? "";
  if (!accessToken || !phoneNumberId) {
    return null;
  }

  const customerLaneReadKey = `${audience}:customer` as const;
  const lastReadAt = conversation.readStateByAudience[customerLaneReadKey] ?? conversation.readStateByAudience[audience];
  const lastReadMs = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  const messageIds = Array.from(
    new Set(
      conversation.messages
        .filter((message) => message.lane === "customer" && message.senderRole === "customer")
        .filter((message) => new Date(message.createdAt).getTime() > lastReadMs)
        .map((message) => message.externalMessageId?.trim() ?? "")
        .filter(Boolean),
    ),
  );

  if (!messageIds.length) {
    return null;
  }

  return {
    accessToken,
    graphApiVersion: connection?.graphApiVersion?.trim() || "v25.0",
    phoneNumberId,
    messageIds,
  };
}

async function postWhatsAppReadReceipt(input: {
  accessToken: string;
  graphApiVersion: string;
  phoneNumberId: string;
  messageId: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(`https://graph.facebook.com/${input.graphApiVersion}/${input.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: input.messageId,
      }),
      signal: controller.signal,
    }).catch((error) => {
      console.error("WhatsApp read receipt request failed", {
        messageId: input.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    });
    if (response && !response.ok) {
      console.error("WhatsApp read receipt was rejected by Meta", {
        messageId: input.messageId,
        status: response.status,
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function queueWhatsAppReadReceipts(
  target: NonNullable<ReturnType<typeof createWhatsAppReadReceiptTarget>>,
) {
  const now = Date.now();
  pruneReadReceiptAttempts(now);

  const pendingMessageIds = target.messageIds.filter((messageId) => {
    const key = `${target.phoneNumberId}:${messageId}`;
    if (recentReadReceiptAttempts.has(key)) {
      return false;
    }
    recentReadReceiptAttempts.set(key, now + READ_RECEIPT_COOLDOWN_MS);
    return true;
  });

  if (!pendingMessageIds.length) {
    return;
  }

  void Promise.allSettled(
    pendingMessageIds.map((messageId) =>
      postWhatsAppReadReceipt({
        accessToken: target.accessToken,
        graphApiVersion: target.graphApiVersion,
        phoneNumberId: target.phoneNumberId,
        messageId,
      }),
    ),
  );
}

async function refreshWhatsAppConnectionFromMeta(tenantId = "tenant-gigxomi", options?: { force?: boolean }) {
  const connection = getWhatsAppConnectionState(tenantId);
  if (!connection) {
    return null;
  }

  const now = Date.now();
  if (!options?.force) {
    const lastAttempt = recentMetaRefreshAttempts.get(tenantId) ?? 0;
    if (now - lastAttempt < META_REFRESH_COOLDOWN_MS) {
      return connection;
    }
  }
  recentMetaRefreshAttempts.set(tenantId, now);

  let accessToken = connection.accessToken.trim();
  let authorizationCode = connection.authorizationCode.trim();
  let exchangeError = "";

  if (!accessToken && authorizationCode && connection.metaAppId.trim()) {
    const exchange = await exchangeMetaAuthorizationCode({
      appId: connection.metaAppId,
      authorizationCode,
      graphApiVersion: connection.graphApiVersion,
      redirectUri: resolveMetaCallbackUrl(connection.publicBaseUrl),
    });

    if (exchange.ok) {
      accessToken = exchange.accessToken;
      authorizationCode = "";
    } else {
      exchangeError = exchange.error;
    }
  }

  if (!accessToken) {
    if (!exchangeError) {
      return connection;
    }

    return updateWhatsAppConnectionState(tenantId, {
      lastError: exchangeError,
      note: "Gigxomi could not refresh the Meta access token yet. Reconnect or refresh the WhatsApp setup first.",
    });
  }

  const summary = await fetchMetaWhatsAppSetupSummary({
    accessToken,
    graphApiVersion: connection.graphApiVersion,
    knownBusinessId: connection.businessId,
    knownBusinessPortfolioId: connection.businessPortfolioId,
    knownWabaId: connection.wabaId,
    knownPhoneNumberId: connection.phoneNumberId,
    knownPhoneNumber: connection.phoneNumber,
    knownDisplayName: connection.displayName,
    knownBusinessName: connection.businessName,
    manualOverrides: connection.manualOverrides,
  });

  if (!summary.ok) {
    if (connection.status === "Ready for webhook" || connection.status === "Number connected") {
      return connection;
    }
    return updateWhatsAppConnectionState(tenantId, {
      accessToken,
      authorizationCode,
      lastError: exchangeError || summary.error,
      note: "Gigxomi synced Meta credentials but could not confirm the Cloud API phone registration yet. Finish the Meta phone registration step if the number still shows pending.",
    });
  }

  const warningNote = summary.warnings.length ? ` ${summary.warnings.join(" ")}` : "";
  const resolvedPhoneNumberId = summary.phoneNumberId || connection.phoneNumberId;

  return updateWhatsAppConnectionState(tenantId, {
    accessToken,
    authorizationCode,
    businessId: summary.businessId || connection.businessId,
    businessPortfolioId: summary.businessPortfolioId || connection.businessPortfolioId,
    wabaId: summary.wabaId || connection.wabaId,
    phoneNumberId: resolvedPhoneNumberId,
    phoneNumber: summary.phoneNumber || connection.phoneNumber,
    displayName: summary.displayName || connection.displayName,
    businessName: summary.businessName || connection.businessName,
    status: resolvedPhoneNumberId ? "Ready for webhook" : summary.wabaId || connection.wabaId ? "Number connected" : connection.status,
    lastError: exchangeError,
    note:
      resolvedPhoneNumberId
        ? `Gigxomi synced the Meta Cloud API phone number details. If Embedded Signup already provisioned this line, it is ready for webhook and test-send validation.${warningNote}`.trim()
        : `Gigxomi synced the Meta business account, but the phone number is still not fully registered for Cloud API sending.${warningNote}`.trim(),
  });
}

async function readSnapshotFile(options?: { useCache?: boolean }) {
  const useCache = options?.useCache !== false;
  const now = Date.now();

  if (useCache && snapshotCache && now - snapshotCache.loadedAt <= SNAPSHOT_CACHE_TTL_MS) {
    return snapshotCache.snapshot;
  }

  const snapshot = hasDatabaseSnapshotStore() ? await readPlatformSnapshotFromDb() : await readSnapshotFromDisk();
  snapshotCache = { snapshot, loadedAt: now };

  return snapshot;
}

async function writeSnapshotFile(snapshot: DummyPlatformSnapshot) {
  await writeSnapshotToDisk(snapshot);
  if (hasDatabaseSnapshotStore()) {
    await writePlatformSnapshotToDb(snapshot);
  }
  snapshotCache = { snapshot, loadedAt: Date.now() };
  lastHydratedSnapshot = snapshot;
}

export function withSnapshot<T>(action: () => Promise<T> | T, options?: { persist?: boolean }) {
  const run = async () => {
    const snapshot = await readSnapshotFile({ useCache: options?.persist === false });
    if (snapshot !== lastHydratedSnapshot) {
      hydrateDummyPlatformSnapshot(snapshot);
      lastHydratedSnapshot = snapshot;
    }

    const result = await action();

    if (options?.persist !== false) {
      const nextSnapshot = getDummyPlatformSnapshot();
      await writeSnapshotFile(nextSnapshot);
      lastHydratedSnapshot = nextSnapshot;
    }

    return result;
  };

  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function withReadSnapshot<T>(action: () => T, options?: { useCache?: boolean }) {
  const snapshot = await readSnapshotFile({ useCache: options?.useCache ?? true });
  if (snapshot !== lastHydratedSnapshot) {
    hydrateDummyPlatformSnapshot(snapshot);
    lastHydratedSnapshot = snapshot;
  }
  return action();
}

async function withExpiringReadSnapshot<T>(action: () => T) {
  const snapshot = await readSnapshotFile({ useCache: true });
  if (snapshot !== lastHydratedSnapshot) {
    hydrateDummyPlatformSnapshot(snapshot);
    lastHydratedSnapshot = snapshot;
  }
  const expiredOffersChanged = expireStaleConversationOffers();
  const result = action();

  if (expiredOffersChanged) {
    void withSnapshot(() => {
      expireStaleConversationOffers();
    }).catch(() => undefined);
  }

  return result;
}

export function listConversationsForAudienceFromFile(
  audience: DummyConversationRole,
  options?: {
    freelancerId?: string;
    freelancerIds?: string[];
    freelancerNames?: string[];
    customerId?: string;
    activeAgencyIds?: string[];
    tenantId?: string;
    includeSupportData?: boolean;
    serviceId?: string;
    lightweight?: boolean;
  },
) {
  return withExpiringReadSnapshot(() => listConversationsForAudience(audience, options));
}

export function getConversationByIdFromFile(conversationId: string) {
  return withReadSnapshot(() => getConversationById(conversationId), { useCache: true });
}

export function updateConversationCustomerProfileFromFile(
  conversationId: string,
  input: { customerName?: string; customerProfileImageUrl?: string },
) {
  return withSnapshot(() => updateConversationCustomerProfile(conversationId, input));
}

export function updateConversationCustomerNameFromFile(conversationId: string, nextCustomerName: string) {
  return withSnapshot(() => updateConversationCustomerName(conversationId, nextCustomerName));
}

export function listAllServicesFromFile() {
  return withSnapshot(
    () => [...getDummyPlatformSnapshot().services].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    { persist: false },
  );
}

export function listFreelancerServicesFromFile(ownerId = "editor-testingfreelancer", ownerName?: string) {
  return withSnapshot(() => listFreelancerServices(ownerId, ownerName), { persist: false });
}

export function listWalletCreditsForEditorFromFile(editorId: string) {
  return withSnapshot(
    () =>
      [...getDummyPlatformSnapshot().walletCredits]
        .filter((credit) => credit.editorId === editorId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    { persist: false },
  );
}

export async function listPublicServicesFromFile() {
  const services = await withSnapshot(() => listPublicServices(), { persist: false });
  const ownerIds = Array.from(new Set(services.map((service) => service.ownerId)));
  if (!ownerIds.length || !process.env.DATABASE_URL?.trim()) return services;
  const [identities, trust] = await Promise.all([
    prisma.appFreelancerIdentity.findMany({ where: { userId: { in: ownerIds }, status: "VERIFIED" }, select: { userId: true } }),
    prisma.appFreelancerTrustSnapshot.findMany({ where: { userId: { in: ownerIds } }, select: { userId: true, score: true } }),
  ]);
  const verified = new Set(identities.map((item) => item.userId));
  const scores = new Map(trust.map((item) => [item.userId, item.score]));
  return services.map((service) => ({ ...service, identityVerified: verified.has(service.ownerId), trustScore: scores.get(service.ownerId) ?? 0 }));
}

export function getPublicCatalogStatsFromFile() {
  return withSnapshot(() => getPublicCatalogStats(), { persist: false });
}

export function getServiceByIdFromFile(serviceId: string) {
  return withSnapshot(() => getServiceById(serviceId), { persist: false });
}

export function getServiceBySlugFromFile(slug: string, includeNonPublic = false) {
  return withSnapshot(() => getServiceBySlug(slug, includeNonPublic), { persist: false });
}

export function upsertFreelancerServiceFromFile(input: UpsertFreelancerServiceInput) {
  return withSnapshot(() => upsertFreelancerService(input));
}

export function submitFreelancerServiceForReviewFromFile(serviceId: string) {
  return withSnapshot(() => submitServiceForReview(serviceId));
}

export function reviewFreelancerServiceFromFile(serviceId: string, action: ReviewFreelancerServiceAction, note?: string) {
  return withSnapshot(() => reviewService(serviceId, action, note));
}

export function setFreelancerServiceAvailabilityFromFile(
  serviceId: string,
  input: {
    listingEnabled?: boolean;
    availability?: "ACTIVE" | "PAUSED";
  },
) {
  return withSnapshot(() => setFreelancerServiceAvailability(serviceId, input));
}

export function createCustomerConversationFromFile(input: {
  serviceId: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  message?: string;
}) {
  return withSnapshot(() => createCustomerConversation(input));
}

export function deliverConversationMessageFromFile(
  conversationId: string,
  input: {
    role: DummyConversationRole;
    body: string;
    lane: DummyConversationLane;
    visibility?: "client_private";
    clientMessageId?: string;
    attachments?: Array<{
      name: string;
      mimeType?: string;
      sizeBytes?: number;
      uploadTarget?: "local" | "youtube";
      durationSeconds?: number;
    }>;
  },
) {
  return withSnapshot(async () => {
    const conversation = getConversationById(conversationId);
    if (
      conversation &&
      !isInstagramConversation(conversation) &&
      input.role !== "customer" &&
      input.lane === "customer" &&
      shouldRefreshWhatsAppBeforeSend(getWhatsAppConnectionState(conversation.tenantId))
    ) {
      await refreshWhatsAppConnectionFromMeta(conversation.tenantId);
    }

    const result = await deliverConversationMessage(conversationId, input);
    return result;
  });
}

export function deleteConversationMessageForEveryoneFromFile(
  conversationId: string,
  messageId: string,
  input: {
    deletedByRole: DummyConversationRole;
    deletedByUserId: string;
  },
) {
  return withSnapshot(() => deleteConversationMessageForEveryone(conversationId, messageId, input));
}

export function setConversationTypingFromFile(
  conversationId: string,
  input: {
    role: DummyConversationRole;
    lane: DummyConversationLane;
    active: boolean;
  },
) {
  const typingKey = `${conversationId}:${input.role}:${input.lane}`;
  const shouldSendTypingIndicator =
    input.role !== "customer" &&
    input.lane === "customer" &&
    shouldSendTypingIndicatorNow(typingKey, input.active);

  return withSnapshot(
    () => {
      const conversation = setConversationTyping(conversationId, input);
      if (conversation && shouldSendTypingIndicator) {
        void sendConversationTypingIndicator({
          conversationId,
          role: input.role,
          lane: input.lane,
          active: true,
        });
      }
      return conversation;
    },
    { persist: false },
  );
}

export function assignConversationFromFile(
  conversationId: string,
  freelancerId: string | string[],
  assignedBy: "manager" | "admin",
  freelancerNameOverride?: string,
  options?: {
    projectDetails?: string;
    offeredByName?: string;
    freelancerNamesById?: Record<string, string>;
    source?: "manual" | "targeted" | "fallback";
    category?: string;
    allowOfflineEditors?: boolean;
    dispatchRequestId?: string;
    intent?: "primary" | "replacement";
  },
) {
  return withSnapshot(() => assignConversation(conversationId, freelancerId, assignedBy, freelancerNameOverride, options));
}

export function assignConversationDirectlyFromFile(
  conversationId: string,
  freelancerId: string,
  assignedBy: "manager" | "admin",
  options?: {
    assignedByName?: string;
    freelancerName?: string;
    projectDetails?: string;
  },
) {
  return withSnapshot(() => assignConversationDirectly(conversationId, freelancerId, assignedBy, options));
}

export function addConversationFreelancerCollaboratorsFromFile(
  conversationId: string,
  freelancerIds: string[],
  addedBy: "manager" | "admin",
  options?: {
    addedByName?: string;
    freelancerNamesById?: Record<string, string>;
  },
) {
  return withSnapshot(() => addConversationFreelancerCollaborators(conversationId, freelancerIds, addedBy, options));
}

export function unassignConversationEditorsFromFile(
  conversationId: string,
  removedBy: "manager" | "admin",
  options?: { removedByName?: string },
) {
  return withSnapshot(() => unassignConversationEditors(conversationId, removedBy, options));
}

export function approveProjectIntakeAndOfferFromFile(
  conversationId: string,
  input: { approvedByRole: "admin" | "manager"; approvedByName: string; fallbackToCategory?: boolean },
) {
  return withSnapshot(() => approveProjectIntakeAndOffer(conversationId, input));
}

export function setEditorProjectAvailabilityFromFile(
  editorId: string,
  input: { onlineStatus?: "online" | "offline"; acceptingProjects?: boolean },
) {
  return withSnapshot(() => setEditorProjectAvailability(editorId, input));
}

export function updateFreelancerCustomerLaneAccessFromFile(
  conversationId: string,
  input: {
    enabled: boolean;
    grantedByRole: "manager" | "admin";
    grantedByName: string;
  },
) {
  return withSnapshot(() => updateFreelancerCustomerLaneAccess(conversationId, input));
}

export function markConversationReadFromFile(conversationId: string, audience: DummyConversationRole, lane?: DummyConversationLane) {
  return withSnapshot(() => {
    const readReceiptTarget = createWhatsAppReadReceiptTarget(conversationId, audience, lane);
    const conversation = markConversationRead(conversationId, audience, lane);
    return { conversation, readReceiptTarget };
  }).then(({ conversation, readReceiptTarget }) => {
    if (readReceiptTarget) {
      queueWhatsAppReadReceipts(readReceiptTarget);
    }
    return conversation;
  });
}

export function updateFreelancerClientAliasFromFile(conversationId: string, freelancerKeys: string[], alias: string) {
  return withSnapshot(() => updateFreelancerClientAlias(conversationId, freelancerKeys, alias));
}

export function updateConversationLeadStatusFromFile(
  conversationId: string,
  leadStatusId?: string,
  notes?: string,
  extras?: { dueDate?: string | null; isPrivate?: boolean },
) {
  return withSnapshot(() => updateConversationLeadStatus(conversationId, leadStatusId, notes, extras));
}

export function updateConversationPrivacyFromFile(conversationId: string, isPrivate: boolean) {
  return withSnapshot(() => updateConversationPrivacy(conversationId, isPrivate));
}

export function updateConversationAiAutoReplyFromFile(
  conversationId: string,
  disabled: boolean,
  updatedByRole: "closer" | "admin" | "manager" | "system" = "closer",
  updatedByName?: string,
) {
  return withSnapshot(() => updateConversationAiAutoReply(conversationId, disabled, updatedByRole, updatedByName));
}

export function updateConversationDueDateFromFile(conversationId: string, dueDate: string | null) {
  return withSnapshot(() => updateConversationDueDate(conversationId, dueDate));
}

export function updateConversationInternalNotesFromFile(conversationId: string, notes: string) {
  return withSnapshot(() => updateConversationInternalNotes(conversationId, notes));
}

export function manageLeadStatusesFromFile(
  conversationId: string,
  input: {
    action: "create" | "update" | "delete" | "reorder";
    statusId?: string;
    label?: string;
    tone?: DummyLeadStatusTone;
    active?: boolean;
    orderedIds?: string[];
    fallbackStatusId?: string;
  },
) {
  return withSnapshot(() => {
    if (conversationId) {
      // Keep the API conversation-scoped while mutating one tenant-level CRM list.
      listConversationsForAudience("admin");
    }
    return manageLeadStatuses(input);
  });
}

export function listLeadStatusesFromFile() {
  return withSnapshot(() => listLeadStatuses(), { persist: false });
}

export function listConversationTemplatesFromFile() {
  return withSnapshot(() => listConversationTemplates(), { persist: false });
}

export function createManualConversationFromFile(input: {
  role: "manager" | "admin" | "sales";
  tenantId?: string;
  ownerName?: string;
  customerName: string;
  customerPhone: string;
  serviceId?: string;
  templateId?: string;
}) {
  return withSnapshot(() => createManualConversation(input));
}

export function createConversationPaymentRequestFromFile(
  conversationId: string,
  input: {
    role: "manager" | "admin" | "freelancer";
    amount: number;
    title: string;
    note: string;
    dueLabel?: string;
    lane?: DummyConversationLane;
    payerRole?: "client" | "agency";
    payeeRole?: "agency" | "freelancer";
    payeeUpiId?: string;
    payeeName?: string;
    assignmentId?: string;
    projectId?: string;
    projectTitle?: string;
    paymentRequestId?: string;
    paymentLink?: string;
    paymentOrderId?: string;
    paymentProvider?: string;
    qrCodeDataUrl?: string;
  },
) {
  return withSnapshot(() => createConversationPaymentRequest(conversationId, input));
}

export function updatePaymentRequestStatusFromFile(
  conversationId: string,
  paymentRequestId: string,
  input:
    | "Draft"
    | "Sent"
    | "Viewed"
    | "Paid"
    | "Failed"
    | "Cancelled"
    | {
        status: "Draft" | "Sent" | "Viewed" | "Paid" | "Failed" | "Cancelled";
        actorRole?: DummyConversationRole;
        actorName?: string;
        proofAttachments?: Array<{
          name: string;
          mimeType?: string;
          sizeLabel?: string;
          note?: string;
          externalUrl?: string;
        }>;
      },
) {
  return withSnapshot(() => updatePaymentRequestStatus(conversationId, paymentRequestId, input));
}

export function listContactsFromFile(audience: "admin" | "manager" = "admin", tenantId?: string) {
  return withSnapshot(() => listContacts(audience, tenantId), { persist: false });
}

export function updateContactFromFile(
  contactId: string,
  updates: Partial<{ tags: string[]; notes: string; latestStatusId: string; assignedUserId: string }>,
  tenantId?: string,
) {
  return withSnapshot(() => updateContact(contactId, updates, tenantId));
}

export function createContactFromFile(
  input: {
    name: string;
    phone: string;
    email?: string;
    currentService?: string;
    notes?: string;
    tags?: string[];
    assignedUserId?: string;
    latestStatusId?: string;
  },
  tenantId?: string,
) {
  return withSnapshot(() => createContact(input, tenantId));
}

export function listManagersFromFile(tenantId?: string) {
  return withSnapshot(() => listManagers(tenantId), { persist: false });
}

export function createManagerAccountFromFile(input: { name: string; email: string; queue: string; tenantId?: string }) {
  return withSnapshot(() => createManagerAccount(input));
}

export function updateManagerPermissionsFromFile(managerId: string, permissions: Partial<DummyManagerPermissionSet>) {
  return withSnapshot(() => updateManagerPermissions(managerId, permissions));
}

export function getManagerByIdFromFile(managerId = "manager-rahul") {
  return withSnapshot(() => getManagerById(managerId), { persist: false });
}

export function getUpiConfigFromFile(tenantId = "tenant-gigxomi") {
  return withSnapshot(() => getUpiConfig(tenantId), { persist: false });
}

export function getCustomerPrivacySettingsFromFile(tenantId = "tenant-gigxomi") {
  return withSnapshot(() => getCustomerPrivacySettings(tenantId), { persist: false });
}

export function updateUpiConfigFromFile(
  tenantId = "tenant-gigxomi",
  updates: Partial<Pick<DummyUpiConfig, "enabled" | "upiId" | "payeeName" | "currency" | "notePrefix">>,
) {
  return withSnapshot(() => updateUpiConfig(tenantId, updates));
}

export function updateCustomerPrivacySettingsFromFile(
  tenantId = "tenant-gigxomi",
  updates: Partial<Pick<DummyCustomerPrivacySettings, "maskCustomerPhoneForManagers" | "maskCustomerPhoneForFreelancers">>,
) {
  return withSnapshot(() => updateCustomerPrivacySettings(tenantId, updates));
}

export function getWhatsAppConnectionStateFromFile(tenantId = "tenant-gigxomi") {
  return withReadSnapshot(() => getWhatsAppConnectionState(tenantId));
}

export function ensureWhatsAppConnectionDraftFromFile(input: {
  tenantId: string;
  businessName?: string | null;
  displayName?: string | null;
  phoneNumber?: string | null;
}) {
  return withSnapshot(() => {
    const tenantId = input.tenantId.trim();
    if (!tenantId) {
      return null;
    }

    const existing = getWhatsAppConnectionState(tenantId);
    if (existing) {
      if (!existing.pluginEnabled) {
        return updateWhatsAppConnectionState(tenantId, {
          pluginEnabled: true,
          note: existing.note || "WhatsApp API plugin enabled for this agency tenant.",
        });
      }
      return existing;
    }

    const displayName = input.displayName?.trim() || input.businessName?.trim() || "Agency tenant";
    return updateWhatsAppConnectionState(tenantId, {
      pluginEnabled: true,
      businessName: input.businessName?.trim() || displayName,
      displayName,
      phoneNumber: input.phoneNumber?.trim() || "",
      status: "Not started",
      note: "WhatsApp setup draft created for this agency tenant. Ready for live Meta line connection.",
    });
  });
}

export function ensureWhatsAppConnectionStateFromFile(tenantId = "tenant-gigxomi", options?: { force?: boolean }) {
  return withSnapshot(() => refreshWhatsAppConnectionFromMeta(tenantId, options));
}

export function listWhatsAppConnectionStatesFromFile() {
  return withReadSnapshot(() => listWhatsAppConnectionStates());
}

export function getInstagramConnectionStateFromFile(tenantId = "tenant-gigxomi") {
  return withSnapshot(() => {
    let state = getInstagramConnectionState(tenantId);
    if (!state) {
      state = ensureInstagramConnectionDraft({ tenantId });
    }
    return state;
  });
}

export function ensureInstagramConnectionDraftFromFile(input: {
  tenantId: string;
  displayName?: string | null;
  username?: string | null;
}) {
  return withSnapshot(() => ensureInstagramConnectionDraft(input));
}

export function listInstagramConnectionStatesFromFile() {
  return withReadSnapshot(() => listInstagramConnectionStates());
}

export function findInstagramConnectionStateByVerifyTokenFromFile(verifyToken?: string | null) {
  return withReadSnapshot(() => findInstagramConnectionStateByVerifyToken(verifyToken));
}

export function updateInstagramConnectionStateFromFile(
  tenantId = "tenant-gigxomi",
  updates: Partial<DummyInstagramConnectionState>,
) {
  return withSnapshot(() => updateInstagramConnectionState(tenantId, updates));
}

type InstagramWebhookSubscriptionResponse = {
  success?: boolean;
  error?: { message?: string };
};

function safeInstagramWebhookError(value: unknown) {
  const message = typeof value === "string" && value.trim()
    ? value.trim()
    : "Meta did not confirm the Instagram messages webhook subscription.";
  return message
    .replace(/(access[_ -]?token\s*[:=]\s*)[^\s&]+/gi, "$1[redacted]")
    .slice(0, 300);
}

async function subscribeInstagramMessagingWebhook(accessToken: string) {
  const url = new URL("https://graph.instagram.com/v25.0/me/subscribed_apps");
  url.searchParams.set("subscribed_fields", "messages");
  url.searchParams.set("access_token", accessToken);

  try {
    const response = await fetch(url, { method: "POST", cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as InstagramWebhookSubscriptionResponse;
    if (!response.ok || payload.success !== true) {
      return {
        ok: false as const,
        error: safeInstagramWebhookError(
          payload.error?.message || `Meta rejected the Instagram messages webhook subscription (HTTP ${response.status}).`,
        ),
      };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Could not reach Meta to subscribe the Instagram messages webhook." };
  }
}

export async function retryInstagramMessagingWebhookSubscriptionFromFile(tenantId = "tenant-gigxomi") {
  const connection = await getInstagramConnectionStateFromFile(tenantId);
  if (!connection) {
    return {
      ok: false as const,
      error: "Instagram connection is not available for this account.",
      connection: null,
    };
  }
  const accessToken = connection.accessToken.trim() ||
    process.env.INSTAGRAM_ACCESS_TOKEN?.trim() ||
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN?.trim() || "";

  if (!accessToken) {
    const error = "Instagram is not connected with an access token. Reconnect the account, then retry.";
    const updated = await updateInstagramConnectionStateFromFile(tenantId, { lastError: error, note: error });
    return { ok: false as const, error, connection: updated };
  }

  const result = await subscribeInstagramMessagingWebhook(accessToken);
  const note = result.ok
    ? "Instagram account is connected and Meta confirmed its messages webhook subscription."
    : `Instagram account is connected, but Meta did not confirm its messages webhook subscription: ${result.error}`;
  const updated = await updateInstagramConnectionStateFromFile(tenantId, {
    lastError: result.ok ? "" : result.error,
    note,
  });

  return { ...result, connection: updated };
}

export function findWhatsAppConnectionStateByVerifyTokenFromFile(verifyToken?: string | null) {
  return withReadSnapshot(() => findWhatsAppConnectionStateByVerifyToken(verifyToken));
}

export function updateWhatsAppConnectionStateFromFile(
  tenantId = "tenant-gigxomi",
  updates: Partial<
    Pick<
      DummyWhatsAppConnectionState,
      | "pluginEnabled"
      | "businessName"
      | "displayName"
      | "phoneNumber"
      | "paymentsEnabled"
      | "paymentsGateway"
      | "paymentsConfigurationName"
      | "paymentsTemplateName"
      | "subscriptionPaymentTemplateName"
      | "subscriptionPaymentTemplateLanguage"
      | "renewalReminderTemplateName"
      | "renewalReminderTemplateLanguage"
      | "otpTemplateName"
      | "otpTemplateLanguage"
      | "status"
      | "note"
      | "metaAppId"
      | "metaConfigId"
      | "sessionInfoVersion"
      | "embeddedSignupVersion"
      | "verifyToken"
      | "publicBaseUrl"
      | "graphApiVersion"
      | "businessId"
      | "businessPortfolioId"
      | "wabaId"
      | "phoneNumberId"
      | "systemUserId"
      | "manualOverrides"
      | "authorizationCode"
      | "accessToken"
      | "lastLaunchAt"
      | "lastInboundAt"
      | "lastOutboundAt"
      | "lastError"
      | "lastSignupEvent"
      | "lastSignupEventAt"
    >
  >,
) {
  return withSnapshot(() => updateWhatsAppConnectionState(tenantId, updates));
}

export function listChannelConnectionsFromFile(tenantId?: string) {
  return withReadSnapshot(() => listChannelConnections(tenantId));
}

export function getChannelConnectionByIdFromFile(id: string) {
  return withReadSnapshot(() => getChannelConnectionById(id));
}

export function findChannelConnectionForWhatsAppFromFile(criteria: {
  phoneNumberId?: string;
  phoneNumber?: string;
  wabaId?: string;
  tenantId?: string;
}) {
  return withReadSnapshot(() => findChannelConnectionForWhatsApp(criteria));
}

export function findChannelConnectionForInstagramFromFile(criteria: {
  instagramBusinessAccountId?: string;
  username?: string;
  tenantId?: string;
}) {
  return withReadSnapshot(() => findChannelConnectionForInstagram(criteria));
}

export function saveChannelConnectionFromFile(connection: ChannelConnection) {
  return withSnapshot(() => saveChannelConnection(connection));
}

export function deleteChannelConnectionFromFile(id: string) {
  return withSnapshot(() => deleteChannelConnection(id));
}

export function updateChannelConnectionNameFromFile(id: string, displayName: string) {
  return withSnapshot(() => updateChannelConnectionName(id, displayName));
}

export type { ChannelConnection, ChannelConnectionProvider, ChannelConnectionStatus };


export function getYouTubeConnectionStateFromFile(tenantId = "tenant-gigxomi") {
  return withSnapshot(() => getYouTubeConnectionState(tenantId), { persist: false });
}

export function listYouTubeUploadsFromFile(tenantId = "tenant-gigxomi") {
  return withSnapshot(() => listYouTubeUploads(tenantId), { persist: false });
}

export function updateYouTubeConnectionStateFromFile(
  tenantId = "tenant-gigxomi",
  updates: Partial<
    Pick<
      DummyYouTubeConnectionState,
      | "status"
      | "channelName"
      | "channelId"
      | "channelHandle"
      | "defaultPrivacy"
      | "defaultPlaylistPrefix"
      | "clientId"
      | "clientSecret"
      | "refreshToken"
      | "accessToken"
      | "note"
      | "lastUploadAt"
      | "lastPlaylistName"
      | "lastError"
    >
  >,
) {
  return withSnapshot(() => updateYouTubeConnectionState(tenantId, updates));
}

export function ingestWhatsAppWebhookPayloadFromFile(payload: unknown) {
  return withSnapshot(() => ingestWhatsAppWebhookPayload(payload));
}

export function ingestInstagramWebhookPayloadFromFile(payload: unknown, options?: { tenantId?: string }) {
  return withSnapshot(() => ingestInstagramWebhookPayload(payload, options));
}

export function sendConversationReviewFlowFromFile(
  conversationId: string,
  input: {
    actorRole: "admin" | "manager" | "freelancer";
    actorLabel?: string;
  },
) {
  return withSnapshot(async () => {
    const conversation = getConversationById(conversationId);
    if (conversation && shouldRefreshWhatsAppBeforeSend(getWhatsAppConnectionState(conversation.tenantId))) {
      await refreshWhatsAppConnectionFromMeta(conversation.tenantId);
    }
    return sendConversationReviewFlow(conversationId, input);
  });
}

export function sendStandaloneWhatsAppMessageFromFile(input: {
  tenantId?: string;
  to: string;
  body: string;
  replyToMessageId?: string;
}) {
  return withSnapshot(async () => {
    const tenantId = input.tenantId ?? "tenant-gigxomi";
    if (shouldRefreshWhatsAppBeforeSend(getWhatsAppConnectionState(tenantId))) {
      await refreshWhatsAppConnectionFromMeta(tenantId);
    }

    let result = await sendStandaloneWhatsAppMessage({ ...input, tenantId });
    if (result.mode === "whatsapp-failed" && shouldRetrySuspiciousWhatsAppSend("error" in result ? result.error : undefined)) {
      const latestConnection = getWhatsAppConnectionState(tenantId);
      if (hasSuspiciousPhoneNumberId(latestConnection)) {
        await refreshWhatsAppConnectionFromMeta(tenantId);
        result = await sendStandaloneWhatsAppMessage({ ...input, tenantId });
      }
    }

    return result;
  });
}

export function sendWhatsAppReactionFromFile(input: {
  tenantId?: string;
  to: string;
  messageId: string;
  emoji: string;
}) {
  return withSnapshot(() => sendWhatsAppReaction(input));
}

export function sendStandaloneWhatsAppCtaUrlMessageFromFile(input: {
  tenantId?: string;
  to: string;
  body: string;
  buttonText?: string;
  displayText?: string;
  url: string;
  headerText?: string;
  footerText?: string;
}) {
  return withSnapshot(async () => {
    const tenantId = input.tenantId ?? "tenant-gigxomi";
    if (shouldRefreshWhatsAppBeforeSend(getWhatsAppConnectionState(tenantId))) {
      await refreshWhatsAppConnectionFromMeta(tenantId);
    }

    const buttonText = input.buttonText || input.displayText || "View Link";
    let result = await sendStandaloneWhatsAppCtaUrlMessage({ ...input, buttonText, tenantId });
    if (result.mode === "whatsapp-failed" && shouldRetrySuspiciousWhatsAppSend("error" in result ? result.error : undefined)) {
      const latestConnection = getWhatsAppConnectionState(tenantId);
      if (hasSuspiciousPhoneNumberId(latestConnection)) {
        await refreshWhatsAppConnectionFromMeta(tenantId);
        result = await sendStandaloneWhatsAppCtaUrlMessage({ ...input, buttonText, tenantId });
      }
    }

    return result;
  });
}

export function sendStandaloneInstagramMessageFromFile(input: { tenantId?: string; to: string; body: string }) {
  return withSnapshot(() => sendStandaloneInstagramMessage(input));
}

export function sendStandaloneWhatsAppCallToActionTemplateFromFile(input: {
  tenantId?: string;
  to: string;
  templateName: string;
  languageCode?: string;
  bodyVariables?: string[];
  buttonUrlVariable?: string;
}) {
  return withSnapshot(async () => {
    const tenantId = input.tenantId ?? "tenant-gigxomi";
    if (shouldRefreshWhatsAppBeforeSend(getWhatsAppConnectionState(tenantId))) {
      await refreshWhatsAppConnectionFromMeta(tenantId);
    }

    let result = await sendStandaloneWhatsAppCallToActionTemplate({ ...input, tenantId });
    if (result.mode === "whatsapp-failed" && shouldRetrySuspiciousWhatsAppSend("error" in result ? result.error : undefined)) {
      const latestConnection = getWhatsAppConnectionState(tenantId);
      if (hasSuspiciousPhoneNumberId(latestConnection)) {
        await refreshWhatsAppConnectionFromMeta(tenantId);
        result = await sendStandaloneWhatsAppCallToActionTemplate({ ...input, tenantId });
      }
    }

    return result;
  });
}

export function sendStandaloneWhatsAppOtpMessageFromFile(input: {
  tenantId?: string;
  to: string;
  code: string;
  fallbackBody?: string;
}) {
  return withSnapshot(async () => {
    const tenantId = input.tenantId ?? "tenant-gigxomi";
    if (shouldRefreshWhatsAppBeforeSend(getWhatsAppConnectionState(tenantId))) {
      await refreshWhatsAppConnectionFromMeta(tenantId);
    }

    let result = await sendStandaloneWhatsAppOtpMessage({ ...input, tenantId });
    if (result.mode === "whatsapp-failed" && shouldRetrySuspiciousWhatsAppSend("error" in result ? result.error : undefined)) {
      const latestConnection = getWhatsAppConnectionState(tenantId);
      if (hasSuspiciousPhoneNumberId(latestConnection)) {
        await refreshWhatsAppConnectionFromMeta(tenantId);
        result = await sendStandaloneWhatsAppOtpMessage({ ...input, tenantId });
      }
    }

    return result;
  });
}

export function getLastInboundPushDispatchSummaryFromFile() {
  return withReadSnapshot(() => null);
}

export function findConversationByCustomerPhoneFromFile(tenantId: string, customerPhone: string) {
  const normalized = String(customerPhone ?? "").replace(/[^\d]/g, "");
  return withReadSnapshot(() => {
    const snapshot = getDummyPlatformSnapshot();
    return (
      snapshot.conversations.find((conversation) => {
        if (conversation.tenantId !== tenantId) return false;
        const phone = String(conversation.customerPhone ?? "").replace(/[^\d]/g, "");
        return Boolean(phone) && phone === normalized;
      }) ?? null
    );
  });
}

export function appendBotFlowReplyByCustomerPhoneFromFile(input: {
  tenantId: string;
  customerPhone: string;
  body: string;
  externalMessageId?: string;
}) {
  return withSnapshot(() => {
    const snapshot = getDummyPlatformSnapshot();
    const normalized = String(input.customerPhone ?? "").replace(/[^\d]/g, "");
    let conversation = snapshot.conversations.find(
      (item) =>
        item.tenantId === input.tenantId &&
        String(item.customerPhone ?? "").replace(/[^\d]/g, "") === normalized,
    );
    if (!conversation) {
      conversation = snapshot.conversations.find(
        (item) =>
          (item.tenantId === "tenant-agency-408de269" ||
            item.tenantId === "tenant-gigxomi" ||
            Boolean(item.tenantId?.startsWith("tenant-gigxomi-sales-agent-"))) &&
          String(item.customerPhone ?? "").replace(/[^\d]/g, "") === normalized,
      );
    }
    if (!conversation) {
      return null;
    }
    return appendConversationMessage(conversation.id, {
      role: "admin",
      lane: "customer",
      body: input.body,
      externalMessageId: input.externalMessageId,
      deliveryStatus: "sent",
    });
  });
}

export function sendStandaloneWhatsAppDocumentFromFile(input: {
  tenantId?: string;
  to: string;
  body?: string;
  fileName?: string;
  mimeType?: string;
  bytes?: Uint8Array;
  documentUrl?: string;
}) {
  return sendStandaloneWhatsAppMessageFromFile({
    tenantId: input.tenantId,
    to: input.to,
    body: [input.body ?? "", input.fileName ? `Document: ${input.fileName}` : "", input.documentUrl ?? ""].filter(Boolean).join("\n"),
  });
}


export function sendStandaloneWhatsAppButtonsMessageFromFile(input: {
  tenantId?: string;
  to: string;
  body: string;
  headerText?: string;
  footerText?: string;
  buttons: Array<{ id: string; title: string }>;
}) {
  const buttonsText = input.buttons.map((button, index) => `${index + 1}. ${button.title}`).join("\n");
  const message = [input.headerText ?? "", input.body, buttonsText, input.footerText ?? ""].filter(Boolean).join("\n");
  return sendStandaloneWhatsAppMessageFromFile({ tenantId: input.tenantId, to: input.to, body: message });
}

export function sendStandaloneWhatsAppListMessageFromFile(input: {
  tenantId?: string;
  to: string;
  body: string;
  buttonText: string;
  headerText?: string;
  footerText?: string;
  sections: Array<{ id: string; title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
}) {
  const rowsText = input.sections
    .flatMap((section) => section.rows.map((row) => `${row.title}${row.description ? ` - ${row.description}` : ""}`))
    .join("\n");
  const message = [input.headerText ?? "", input.body, `Options (${input.buttonText}):`, rowsText, input.footerText ?? ""]
    .filter(Boolean)
    .join("\n");
  return sendStandaloneWhatsAppMessageFromFile({ tenantId: input.tenantId, to: input.to, body: message });
}

export function updateConversationFreelancerClientAliasFromFile(
  conversationId: string,
  input: { alias: string },
) {
  return withSnapshot(() => {
    const conversation = getConversationById(conversationId);
    if (!conversation) return null;
    const keys = [conversation.assignedFreelancerId, conversation.assignedFreelancerName]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    return updateFreelancerClientAlias(conversationId, keys, input.alias);
  });
}

export function respondToConversationAssignmentFromFile(
  conversationId: string,
  input: {
    action: "ACCEPT" | "PASS";
    actorRole: "admin" | "manager" | "freelancer";
    actorName: string;
    actorUserId?: string;
    actorCandidateIds?: string[];
    actorCandidateNames?: string[];
    rejectionReason?: string;
  },
) {
  return withSnapshot(() => respondToConversationAssignment(conversationId, input));
}

function getInstagramOAuthClientId(tenantId = "tenant-gigxomi") {
  return (
    process.env.INSTAGRAM_OAUTH_CLIENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_INSTAGRAM_OAUTH_CLIENT_ID?.trim() ||
    getWhatsAppConnectionState(tenantId)?.metaAppId?.trim() ||
    process.env.META_WHATSAPP_APP_ID?.trim() ||
    process.env.META_APP_ID?.trim() ||
    process.env.FACEBOOK_APP_ID?.trim() ||
    ""
  );
}

function getWhatsAppMetaAppId(tenantId = "tenant-gigxomi") {
  return (
    getWhatsAppConnectionState(tenantId)?.metaAppId?.trim() ||
    process.env.META_WHATSAPP_APP_ID?.trim() ||
    process.env.META_APP_ID?.trim() ||
    process.env.FACEBOOK_APP_ID?.trim() ||
    ""
  );
}

function getInstagramOAuthClientSecret(tenantId = "tenant-gigxomi") {
  const dedicatedSecret = process.env.INSTAGRAM_OAUTH_CLIENT_SECRET?.trim() || process.env.INSTAGRAM_APP_SECRET?.trim();
  if (dedicatedSecret) {
    return dedicatedSecret;
  }

  if (getInstagramOAuthClientId(tenantId) !== getWhatsAppMetaAppId(tenantId)) {
    return "";
  }

  return process.env.META_APP_SECRET?.trim() || process.env.FACEBOOK_APP_SECRET?.trim() || process.env.GIGXOMI_META_APP_SECRET?.trim() || "";
}

export function getInstagramOAuthAuthorizeUrlFromFile(input: { redirectUri: string; state: string; tenantId?: string }) {
  const clientId = getInstagramOAuthClientId(input.tenantId);
  if (!clientId) {
    throw new Error("Instagram OAuth client id is missing.");
  }
  if (!getInstagramOAuthClientSecret(input.tenantId)) {
    throw new Error("Instagram OAuth app secret is missing. Configure the secret for this Instagram Business Login app on the server.");
  }
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set(
    "scope",
    "instagram_business_basic,instagram_business_manage_messages",
  );
  url.searchParams.set("response_type", "code");
  url.hash = "weblink";
  return url.toString();
}

export async function exchangeInstagramOAuthCodeFromFile(input: {
  code: string;
  redirectUri: string;
  tenantId?: string;
}) {
  const tenantId = input.tenantId ?? "tenant-gigxomi";
  const appId = getInstagramOAuthClientId(tenantId);
  const appSecret = getInstagramOAuthClientSecret(tenantId);
  if (!appId || !appSecret) {
    throw new Error("Instagram OAuth app credentials are missing.");
  }

  const cleanCode = input.code.replace(/#_.*$/, "").trim();

  const tokenBody = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code: cleanCode,
  });
  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    user_id?: string | number;
    error?: { message?: string };
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(String(payload.error?.message ?? "Instagram OAuth exchange failed."));
  }

  const profileUrl = new URL("https://graph.instagram.com/me");
  profileUrl.searchParams.set("fields", "id,username");
  profileUrl.searchParams.set("access_token", payload.access_token);
  const profileResponse = await fetch(profileUrl.toString(), { method: "GET" });
  const profile = (await profileResponse.json().catch(() => ({}))) as {
    id?: string | number;
    username?: string;
    error?: { message?: string };
  };
  const instagramBusinessAccountId = String(profile.id ?? payload.user_id ?? "").trim();
  if (!profileResponse.ok || !instagramBusinessAccountId) {
    throw new Error(String(profile.error?.message ?? "Instagram did not return the professional account identity."));
  }

  let activeToken = payload.access_token;
  let tokenExpiresAt = "";

  // Attempt to exchange short-lived 1-hour token for 60-day long-lived token
  try {
    const exchangeUrl = new URL("https://graph.instagram.com/access_token");
    exchangeUrl.searchParams.set("grant_type", "ig_exchange_token");
    exchangeUrl.searchParams.set("client_secret", appSecret);
    exchangeUrl.searchParams.set("access_token", payload.access_token);

    const exchangeRes = await fetch(exchangeUrl.toString(), { method: "GET" });
    const exchangeData = (await exchangeRes.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    if (exchangeRes.ok && exchangeData.access_token) {
      activeToken = exchangeData.access_token;
      const longLivedSeconds = Number(exchangeData.expires_in ?? 5184000);
      tokenExpiresAt = new Date(Date.now() + longLivedSeconds * 1000).toISOString();
    }
  } catch {
    const expiresInSeconds = Number(payload.expires_in ?? 0);
    tokenExpiresAt = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : "";
  }

  // A connected OAuth account does not receive DMs until Meta confirms this subscription.
  const webhookSubscription = await subscribeInstagramMessagingWebhook(activeToken);

  const username = String(profile.username ?? "").trim();
  const cleanHandle = username.replace(/^@/, "");

  // Also sync into multi-account channel connections
  try {
    await saveChannelConnectionFromFile({
      id: `conn-ig-${instagramBusinessAccountId}`,
      tenantId,
      provider: "INSTAGRAM",
      displayName: cleanHandle ? `@${cleanHandle}` : "Agency Instagram",
      accountHandle: cleanHandle ? `@${cleanHandle}` : undefined,
      instagramBusinessAccountId,
      status: "ACTIVE",
      isDefault: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // ignore
  }

  return updateInstagramConnectionStateFromFile(tenantId, {
    accessToken: activeToken,
    accountId: instagramBusinessAccountId,
    accountType: "Instagram professional account",
    connectedAt: new Date().toISOString(),
    expiresAt: tokenExpiresAt,
    graphApiVersion: "v25.0",
    instagramBusinessAccountId,
    status: "Connected",
    lastError: webhookSubscription.ok ? "" : webhookSubscription.error,
    note: webhookSubscription.ok
      ? "Instagram OAuth connected and Meta confirmed the messages webhook subscription."
      : `Instagram OAuth connected, but Meta did not confirm the messages webhook subscription: ${webhookSubscription.error}`,
    scopes: [
      "instagram_business_basic",
      "instagram_business_manage_messages",
    ],
    tokenType: String(payload.token_type ?? "Bearer"),
    username,
  });
}


