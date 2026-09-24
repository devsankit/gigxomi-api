import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getFreelancerConversationAccess } from "@/lib/api/conversation-access";
import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import QRCode from "qrcode";
import { buildUpiPaymentUri } from "@/lib/billing/manual-upi-config-service";
import { PhonePeHttpClient, readPhonePeRedirectUrl } from "@/lib/billing/phonepe-client";
import {
  createConversationPaymentRequestFromFile,
  getConversationByIdFromFile,
  getUpiConfigFromFile,
  updatePaymentRequestStatusFromFile,
  updateUpiConfigFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { upsertFreelancerPaymentDetails } from "@/lib/gigxomi/freelancer-workspace-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const MAX_CHAT_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface CachedPaymentResponse {
  timestamp: number;
  response: Record<string, unknown>;
}

const recentPaymentRequests = new Map<string, CachedPaymentResponse>();
const inFlightPaymentRequests = new Map<string, Promise<Record<string, unknown>>>();

function getRequestOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (host) {
    const proto = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

function buildPhonePeOrderId() {
  return `GXCHAT${Date.now()}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function buildPaymentRequestId() {
  return `payreq-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

async function createPhonePeChatCheckout(input: {
  amount: number;
  conversationId: string;
  merchantOrderId: string;
  origin: string;
  paymentRequestId: string;
  title: string;
}) {
  const redirectUrl = new URL("/api/payments/phonepe/chat-return", input.origin);
  redirectUrl.searchParams.set("conversationId", input.conversationId);
  redirectUrl.searchParams.set("paymentRequestId", input.paymentRequestId);
  redirectUrl.searchParams.set("merchantOrderId", input.merchantOrderId);

  const payload = {
    merchantOrderId: input.merchantOrderId,
    amount: Math.max(1, Math.round(input.amount * 100)),
    expireAfter: 1200,
    metaInfo: {
      udf1: "gigxomi-chat-payment",
      udf2: input.conversationId.slice(0, 64),
      udf3: input.paymentRequestId.slice(0, 64),
      udf4: input.title.slice(0, 64),
      udf5: "chat-payment-link",
    },
    paymentFlow: {
      type: "PG_CHECKOUT",
      message: input.title.slice(0, 120) || "Gigxomi project payment",
      merchantUrls: {
        redirectUrl: redirectUrl.toString(),
      },
    },
  };

  const raw = await new PhonePeHttpClient().request("/checkout/v2/pay", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const phonePeRedirectUrl = readPhonePeRedirectUrl(raw);

  if (!phonePeRedirectUrl) {
    throw new Error("PhonePe did not return a checkout URL.");
  }

  return phonePeRedirectUrl;
}

function normalizeProofAttachments(value: unknown) {
  const attachments: Array<{ name: string; mimeType?: string; sizeLabel?: string; note?: string; externalUrl?: string }> = [];

  if (!Array.isArray(value)) {
    return attachments;
  }

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const name = String(candidate.name ?? "").trim();
    if (!name) {
      continue;
    }

    const sizeBytes = typeof candidate.sizeBytes === "number" && Number.isFinite(candidate.sizeBytes) ? Math.max(0, Math.floor(candidate.sizeBytes)) : 0;
    if (sizeBytes > MAX_CHAT_ATTACHMENT_BYTES) {
      continue;
    }

    const sizeLabel =
      typeof candidate.sizeLabel === "string" && candidate.sizeLabel.trim()
        ? candidate.sizeLabel.trim()
        : sizeBytes > 0
          ? `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
          : "Attachment";

    attachments.push({
      name,
      mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : undefined,
      sizeLabel,
      note: typeof candidate.note === "string" ? candidate.note : undefined,
      externalUrl: typeof candidate.externalUrl === "string" ? candidate.externalUrl : undefined,
    });
  }

  return attachments;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json();
  const role: "admin" | "manager" | "freelancer" =
    authorization.session.role === "MANAGER" ? "manager" : authorization.session.role === "FREELANCER" ? "freelancer" : "admin";

  if (role === "freelancer") {
    const access = await getFreelancerConversationAccess(authorization.session, id);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.reason === "missing" ? "Conversation not found." : "You do not have access to this conversation." },
        { status: access.reason === "missing" ? 404 : 403 },
      );
    }
    if (!access.canWriteInternalLane) {
      return NextResponse.json(
        { ok: false, error: "Only the primary editor can create or update project payment requests." },
        { status: 403 },
      );
    }
  }

  const scopedConversationView = await getConversationViewForSession(authorization.session, id);
  if (!scopedConversationView) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  if (body.action === "mark-status") {
    const conversation = await updatePaymentRequestStatusFromFile(id, body.paymentRequestId ?? "", {
      status: body.status ?? "Draft",
      actorRole: role,
      actorName: authorization.session.displayName,
    });

    if (!conversation) {
      return NextResponse.json({ ok: false, error: "Unable to update payment request" }, { status: 404 });
    }

    if ("error" in conversation) {
      return NextResponse.json({ ok: false, error: conversation.error }, { status: 403 });
    }

    const conversationView = await getConversationViewForSession(authorization.session, id);

    return NextResponse.json({
      ok: true,
      conversation: conversationView,
    });
  }

  if (body.action === "submit-proof") {
    const proofAttachments = normalizeProofAttachments(body.attachments);
    if (!proofAttachments.length) {
      return NextResponse.json({ ok: false, error: "Attach at least one proof file up to 20 MB." }, { status: 400 });
    }

    const conversation = await updatePaymentRequestStatusFromFile(id, body.paymentRequestId ?? "", {
      status: body.status ?? "Sent",
      actorRole: role,
      actorName: authorization.session.displayName,
      proofAttachments,
    });

    if (!conversation) {
      return NextResponse.json({ ok: false, error: "Unable to update payment proof" }, { status: 404 });
    }

    if ("error" in conversation) {
      return NextResponse.json({ ok: false, error: conversation.error }, { status: 403 });
    }

    const conversationView = await getConversationViewForSession(authorization.session, id);

    return NextResponse.json({
      ok: true,
      conversation: conversationView,
    });
  }

  const lane = body.lane === "internal" ? "internal" : "customer";

  if (role === "freelancer" && lane !== "internal") {
    return NextResponse.json(
      { ok: false, error: "Freelancer payment requests are allowed only in internal lane." },
      { status: 403 },
    );
  }

  const amount = Number(body.amount ?? 0);
  if (!amount || amount <= 0) {
    return NextResponse.json({ ok: false, error: "Enter a valid payment amount." }, { status: 400 });
  }

  // Rapid duplicate prevention: if user double-clicked or resent within 20 seconds, reuse link
  const dedupeKey = `${id}:${lane}:${amount}`;
  const now = Date.now();

  // If another request is currently creating a PhonePe checkout for this same dedupeKey, await it
  const inFlight = inFlightPaymentRequests.get(dedupeKey);
  if (inFlight) {
    console.warn(`[chat-payment] Awaiting concurrent in-flight payment request for ${dedupeKey}`);
    const concurrentResult = await inFlight.catch(() => null);
    if (concurrentResult) {
      return NextResponse.json(concurrentResult);
    }
  }

  const cached = recentPaymentRequests.get(dedupeKey);
  if (cached && now - cached.timestamp < 20_000) {
    console.warn(`[chat-payment] Returning deduplicated rapid payment request for ${dedupeKey}`);
    return NextResponse.json(cached.response);
  }

  const existingConv = await getConversationByIdFromFile(id);
  const recentInConv = existingConv?.paymentRequests
    ?.filter((pr) => pr.amount === amount && pr.lane === lane)
    ?.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (recentInConv && now - new Date(recentInConv.createdAt).getTime() < 20_000) {
    console.warn(`[chat-payment] Returning recent conversation payment request within 20s: ${recentInConv.id}`);
    const conversationView = await getConversationViewForSession(authorization.session, id);
    return NextResponse.json({
      ok: true,
      paymentRequest: recentInConv,
      conversation: conversationView,
    });
  }

  const executeCreation = async (): Promise<Record<string, unknown>> => {
    const paymentRequestId = buildPaymentRequestId();
    const merchantOrderId = buildPhonePeOrderId();
    const paymentTitle = String(body.title ?? "").trim() || "Project payment";

    const isFreelancerPayout = role === "freelancer" || lane === "internal" || body.payeeRole === "freelancer";
    const resolvedPayerRole: "agency" | "client" = isFreelancerPayout ? "agency" : "client";
    const resolvedPayeeRole: "freelancer" | "agency" = isFreelancerPayout ? "freelancer" : "agency";

    let resolvedPayeeUpiId = typeof body.payeeUpiId === "string" ? body.payeeUpiId.trim() : "";
    let resolvedPayeeName = typeof body.payeeName === "string" ? body.payeeName.trim() : "";

    if (isFreelancerPayout) {
      if (!resolvedPayeeUpiId) {
        resolvedPayeeUpiId = scopedConversationView.assignedFreelancerId ? `${scopedConversationView.assignedFreelancerId}@upi` : "editor@upi";
      }
      if (!resolvedPayeeName) {
        resolvedPayeeName = authorization.session.displayName || scopedConversationView.assignedFreelancerName || "Editor";
      }
    } else {
      const agencyUpiConfig = await getUpiConfigFromFile().catch(() => null);
      if (!resolvedPayeeUpiId) {
        resolvedPayeeUpiId = agencyUpiConfig?.upiId || "7974063067@ybl";
      }
      if (!resolvedPayeeName) {
        resolvedPayeeName = agencyUpiConfig?.payeeName || "Post Production Work Dewas";
      }
    }

    if (body.saveToProfile) {
      try {
        if (isFreelancerPayout && authorization.session.userId) {
          await upsertFreelancerPaymentDetails(
            authorization.session.userId,
            {
              userId: authorization.session.userId,
              displayName: authorization.session.displayName ?? null,
              email: authorization.session.email ?? null,
              phone: authorization.session.phone ?? null,
            },
            {
              upiId: resolvedPayeeUpiId,
              bankAccountName: resolvedPayeeName,
            },
          );
        } else if (!isFreelancerPayout) {
          await updateUpiConfigFromFile("tenant-gigxomi", {
            upiId: resolvedPayeeUpiId,
            payeeName: resolvedPayeeName,
            enabled: true,
          });
        }
      } catch (saveErr) {
        console.warn("[chat-payment] Failed to save UPI profile settings", saveErr);
      }
    }

    const upiUri = buildUpiPaymentUri({
      amount,
      currency: "INR",
      note: `${isFreelancerPayout ? "Editor Payout" : "Gigxomi Project"} - ${paymentTitle}`.slice(0, 80),
      payeeName: resolvedPayeeName,
      transactionReference: paymentRequestId,
      upiId: resolvedPayeeUpiId,
    });

    let qrCodeDataUrl = "";
    try {
      qrCodeDataUrl = await QRCode.toDataURL(upiUri, {
        margin: 1,
        width: 320,
        color: { dark: "#000000", light: "#ffffff" },
      });
    } catch (err) {
      console.error("[chat-payment] QR code generation failed", err);
    }

    let paymentLink = upiUri;
    let paymentProvider = "upi";

    if (!isFreelancerPayout) {
      try {
        const phonePeLink = await createPhonePeChatCheckout({
          amount,
          conversationId: id,
          merchantOrderId,
          origin: getRequestOrigin(request),
          paymentRequestId,
          title: paymentTitle,
        });
        if (phonePeLink) {
          paymentLink = phonePeLink;
          paymentProvider = "phonepe";
        }
      } catch (phonePeError) {
        console.warn("[chat-payment] PhonePe checkout unavailable, falling back to direct UPI QR", phonePeError);
      }
    }

    const result = await createConversationPaymentRequestFromFile(id, {
      role,
      amount,
      title: paymentTitle,
      note: body.note ?? "",
      dueLabel: body.dueLabel ?? undefined,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      projectTitle: typeof body.projectTitle === "string" ? body.projectTitle : scopedConversationView.serviceTitle,
      lane,
      payerRole: resolvedPayerRole,
      payeeRole: resolvedPayeeRole,
      payeeUpiId: resolvedPayeeUpiId,
      payeeName: resolvedPayeeName,
      paymentRequestId,
      paymentLink,
      paymentOrderId: merchantOrderId,
      paymentProvider,
      qrCodeDataUrl,
    });

    if (!result || "error" in result) {
      throw new Error(result && "error" in result ? result.error : "Conversation not found");
    }

    const conversationView = await getConversationViewForSession(authorization.session, id);
    const responsePayload = {
      ok: true,
      ...result,
      conversation: conversationView,
    };

    recentPaymentRequests.set(dedupeKey, {
      timestamp: Date.now(),
      response: responsePayload,
    });

    return responsePayload;
  };

  const creationPromise = executeCreation();
  inFlightPaymentRequests.set(dedupeKey, creationPromise);

  try {
    const responsePayload = await creationPromise;

    if (recentPaymentRequests.size > 200) {
      const cutoff = Date.now() - 60_000;
      for (const [key, val] of recentPaymentRequests.entries()) {
        if (val.timestamp < cutoff) recentPaymentRequests.delete(key);
      }
    }

    return NextResponse.json(responsePayload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not create payment request.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  } finally {
    inFlightPaymentRequests.delete(dedupeKey);
  }
}


