import "server-only";

import { prisma } from "@/lib/prisma";
import { createOtpChallenge, findUserByIdentifier } from "@/lib/auth/store";
import { getPhoneDigits, normalizePhone } from "@/lib/auth/normalize";
import {
  createPublicAuthIntent,
  getLatestActivePublicAuthIntentByPhone,
  getLatestRecoverablePublicAuthIntentByPhone,
  markPublicAuthIntentOtpIssued,
} from "@/lib/auth/public-auth-intent-store";
import { sanitizePublicAuthError } from "@/lib/auth/public-redirect";
import {
  sendStandaloneWhatsAppMessageFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { resolvePublicAuthWhatsAppConnection } from "@/lib/auth/public-whatsapp-channel";

const PUBLIC_AUTH_OTP_COMMAND = "Get OTP";
// This is Gigxomi's public authentication line. It is intentionally fixed so
// login and signup never send customers to a legacy agency/admin number.
const PUBLIC_AUTH_OTP_PHONE_DIGITS = "919981807309";
const OTP_MESSAGE_ID_TTL_MS = 60 * 60 * 1000;
const OTP_DEBOUNCE_MS = 5 * 1000;

const OTP_EXPLICIT_TRIGGERS = new Set([
  "get otp",
  "otp",
  "send otp",
  "resend otp",
  "get code",
  "send code",
  "code",
  "verification code",
  "my otp",
  "login",
  "log in",
  "signin",
  "sign in",
  "signup",
  "sign up",
  "start",
]);

const GREETING_TRIGGERS = new Set([
  "hi",
  "hello",
  "hey",
  "hii",
  "hiii",
  "helo",
  "start",
  "ok",
  "yes",
]);

const recentOtpMessageIds = new Map<string, number>();

type PublicAuthChannelInfo = {
  tenantId: string;
  digits: string;
  label: string;
  whatsappHref: string | null;
  phoneNumberId: string;
  isConfigured: boolean;
};

type WebhookPayload = {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        messages?: Array<Record<string, unknown>>;
      };
    }>;
  }>;
};

function normalizeCommand(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isOtpCommand(value: string, hasActiveIntent = false) {
  const normalized = normalizeCommand(value).replace(/[.!?,;:]+$/, "");
  if (!normalized) {
    return false;
  }

  if (normalized === normalizeCommand(PUBLIC_AUTH_OTP_COMMAND)) {
    return true;
  }

  if (OTP_EXPLICIT_TRIGGERS.has(normalized)) {
    return true;
  }

  if (/\b(get\s*otp|send\s*otp|resend\s*otp|my\s*otp|get\s*code|verification\s*code)\b/i.test(value)) {
    return true;
  }

  if (hasActiveIntent && GREETING_TRIGGERS.has(normalized)) {
    return true;
  }

  return false;
}

function pruneRecentOtpRequests(now = Date.now()) {
  for (const [messageId, expiresAt] of recentOtpMessageIds) {
    if (expiresAt <= now) {
      recentOtpMessageIds.delete(messageId);
    }
  }
}

function isRepeatedWebhookDelivery(messageId?: string) {
  const now = Date.now();
  pruneRecentOtpRequests(now);

  const normalizedMessageId = messageId?.trim();
  if (!normalizedMessageId) {
    return false;
  }

  if (recentOtpMessageIds.has(normalizedMessageId)) {
    return true;
  }

  recentOtpMessageIds.set(normalizedMessageId, now + OTP_MESSAGE_ID_TTL_MS);
  return false;
}

function formatChannelLabel(digits: string) {
  if (!digits) {
    return "official Gigxomi WhatsApp number";
  }

  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }

  return `+${digits}`;
}

async function resolvePublicAuthChannelInfo(): Promise<PublicAuthChannelInfo> {
  const connection = await resolvePublicAuthWhatsAppConnection();
  const digits = PUBLIC_AUTH_OTP_PHONE_DIGITS;

  return {
    tenantId: connection?.tenantId?.trim() || "",
    digits,
    label: formatChannelLabel(digits),
    whatsappHref: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(PUBLIC_AUTH_OTP_COMMAND)}` : null,
    phoneNumberId: connection?.phoneNumberId?.trim() ?? "",
    isConfigured: Boolean(
      connection?.tenantId?.trim() &&
      connection.phoneNumberId?.trim() &&
      connection.accessToken?.trim(),
    ),
  };
}

function extractMessageBody(message: Record<string, unknown>) {
  const textBody = typeof (message.text as { body?: unknown } | undefined)?.body === "string" ? String((message.text as { body?: string }).body) : "";
  if (textBody.trim()) {
    return textBody.trim();
  }

  const buttonBody = typeof (message.button as { text?: unknown } | undefined)?.text === "string" ? String((message.button as { text?: string }).text) : "";
  if (buttonBody.trim()) {
    return buttonBody.trim();
  }

  const interactive = message.interactive as { button_reply?: { title?: unknown }; list_reply?: { title?: unknown } } | undefined;
  const interactiveTitle =
    typeof interactive?.button_reply?.title === "string"
      ? String(interactive.button_reply.title)
      : typeof interactive?.list_reply?.title === "string"
        ? String(interactive.list_reply.title)
        : "";

  return interactiveTitle.trim();
}

function isSystemChannel(
  input: { displayPhoneNumber?: string; phoneNumberId?: string },
  channel: PublicAuthChannelInfo,
) {
  if (channel.phoneNumberId) {
    return input.phoneNumberId?.trim() === channel.phoneNumberId;
  }

  const incomingDigits = getPhoneDigits(input.displayPhoneNumber ?? "");
  if (!incomingDigits) {
    return false;
  }

  return incomingDigits === channel.digits || incomingDigits.endsWith(channel.digits) || channel.digits.endsWith(incomingDigits);
}

async function sendAuthChannelMessage(phone: string, body: string) {
  const channel = await resolvePublicAuthChannelInfo();
  if (!channel.isConfigured || !channel.tenantId) {
    throw new Error("The official WhatsApp authentication line is not configured.");
  }
  return sendStandaloneWhatsAppMessageFromFile({
    tenantId: channel.tenantId,
    to: phone,
    body,
  });
}

async function maybeAcknowledgeManualPaymentMessage(phone: string) {
  const digits = getPhoneDigits(phone);
  const lookupDigits = digits.length > 10 ? digits.slice(-10) : digits;
  if (!lookupDigits) {
    return { handled: false as const };
  }

  const candidates = await prisma.paymentTransaction.findMany({
    where: {
      provider: "UPI_MANUAL",
      status: { in: ["PENDING", "INITIATED"] },
      user: {
        phone: {
          contains: lookupDigits,
        },
      },
    },
    include: {
      package: true,
      user: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  const transaction =
    candidates.find((candidate) => {
      const candidateDigits = getPhoneDigits(candidate.user.phone);
      return candidateDigits.endsWith(lookupDigits) || lookupDigits.endsWith(candidateDigits.slice(-10));
    }) ?? null;

  if (!transaction) {
    return { handled: false as const };
  }

  const existingAck = await prisma.paymentLog.findFirst({
    where: {
      transactionId: transaction.id,
      eventType: "manual_upi_customer_ack_sent",
    },
    select: { id: true },
  });

  if (existingAck) {
    return { handled: false as const };
  }

  const firstName = transaction.user.displayName.trim().split(/\s+/)[0] || "there";
  const body = [
    `Thank you for your subscription, ${firstName}.`,
    `We received your payment update for ${transaction.package.name}.`,
    "Our team will review and activate your subscription as soon as possible, usually within 12 hours.",
  ].join("\n\n");

  const delivery = await sendAuthChannelMessage(phone, body).catch((error) => ({
    ok: false,
    mode: "whatsapp-failed" as const,
    error: error instanceof Error ? error.message : "Manual payment acknowledgement failed",
  }));

  await prisma.paymentLog.create({
    data: {
      transactionId: transaction.id,
      eventType: "manual_upi_customer_ack_sent",
      status: delivery.ok ? delivery.mode : "failed",
      payload: {
        body,
        delivery,
        phone,
      },
    },
  });

  return {
    handled: true as const,
    summary: `Manual payment acknowledgement sent to ${phone}`,
  };
}

async function handleIntentOtpRequest(phone: string) {
  let intent = (await getLatestActivePublicAuthIntentByPhone(phone)) ?? (await getLatestRecoverablePublicAuthIntentByPhone(phone));
  if (!intent) {
    const existingUser = await findUserByIdentifier(phone);
    if (existingUser) {
      intent = await createPublicAuthIntent({
        flow: "LOGIN",
        phone,
        userId: existingUser.id,
      });
    }
  }

  if (!intent) {
    await sendAuthChannelMessage(
      phone,
      "We could not find an active Gigxomi registration for this WhatsApp number. Please sign up at https://gigxomi.com to get started, or send Get OTP from your registered number.",
    );

    return {
      handled: true,
      summary: `Auth OTP request rejected for ${phone}`,
    };
  }

  const challengeIssuedAt = intent.challengeIssuedAt ? Date.parse(intent.challengeIssuedAt) : Number.NaN;
  if (intent.challengeId && Number.isFinite(challengeIssuedAt) && challengeIssuedAt > Date.now() - OTP_DEBOUNCE_MS) {
    return {
      handled: true,
      summary: `Fast repeat OTP request debounced for ${phone}`,
    };
  }

  if (intent.flow === "LOGIN") {
    const user = await findUserByIdentifier(intent.phone);
    if (!user) {
      await sendAuthChannelMessage(
        phone,
        "No Gigxomi account is linked to this WhatsApp number yet. Please sign up on gigxomi.com first, then send Get OTP again.",
      );

      return {
        handled: true,
        summary: `Login OTP request rejected for ${phone}`,
      };
    }

    const challenge = await createOtpChallenge(intent.phone);
    if (!challenge) {
      await sendAuthChannelMessage(phone, "We could not create your login code right now. Please try again in a moment.");
      return {
        handled: true,
        summary: `Login OTP request failed for ${phone}`,
      };
    }

    if (challenge.deliveryMode !== "whatsapp-sent") {
      await sendAuthChannelMessage(phone, "We could not send your login code yet. Please try again in a moment.");
      return {
        handled: true,
        summary: `Login OTP delivery failed for ${phone}`,
      };
    }

    await markPublicAuthIntentOtpIssued({
      intentId: intent.id,
      challengeId: challenge.challengeId,
      userId: challenge.user.id,
      whatsappVerifiedAt: new Date().toISOString(),
    });

    return {
      handled: true,
      summary: `Login OTP sent to ${phone}`,
    };
  }

  try {
    // Signup already created the account and selected its package before the
    // customer reaches WhatsApp. Re-running registration here can conflict
    // with a free, already-active package. Issue a code for that same account
    // instead, exactly as the login path does.
    const challenge = await createOtpChallenge(intent.phone);
    if (!challenge) {
      await sendAuthChannelMessage(phone, "We could not create your signup code right now. Please try again in a moment.");
      return {
        handled: true,
        summary: `Signup OTP request failed for ${phone}`,
      };
    }

    if (challenge.deliveryMode !== "whatsapp-sent") {
      await sendAuthChannelMessage(phone, "We could not send your signup code yet. Please try again in a moment.");
      return {
        handled: true,
        summary: `Signup OTP delivery failed for ${phone}`,
      };
    }

    // The connected v2 mobile onboarding screen verifies by its own intent
    // id. Point any active signup intent for this account at the freshly
    // delivered code so the code received after `Get OTP` can be consumed.
    const verifiedAt = new Date();
    await prisma.connectedSignupIntent.updateMany({
      where: {
        phone: intent.phone,
        userId: challenge.user.id,
        status: "OTP_ISSUED",
        expiresAt: { gt: new Date() },
      },
      data: {
        challengeId: challenge.challengeId,
        expiresAt: new Date(challenge.expiresAt),
        status: "VERIFIED",
        verifiedAt,
      },
    });

    await markPublicAuthIntentOtpIssued({
      intentId: intent.id,
      challengeId: challenge.challengeId,
      userId: challenge.user.id,
      whatsappVerifiedAt: new Date().toISOString(),
    });

    return {
      handled: true,
      summary: `Signup OTP sent to ${phone}`,
    };
  } catch (error) {
    await sendAuthChannelMessage(
      phone,
      sanitizePublicAuthError(error, "We could not create your Gigxomi OTP right now. Please try again in a moment."),
    );
    return {
      handled: true,
      summary: `Signup OTP request failed for ${phone}`,
    };
  }
}

export async function buildPublicAuthWhatsAppHref() {
  return (await resolvePublicAuthChannelInfo()).whatsappHref;
}

export function getPublicAuthOtpCommand() {
  return PUBLIC_AUTH_OTP_COMMAND;
}

export async function getPublicAuthOtpChannelLabel() {
  return (await resolvePublicAuthChannelInfo()).label;
}

export async function getPublicAuthOtpChannelInfo() {
  return resolvePublicAuthChannelInfo();
}

export async function processPublicAuthWebhookPayload(payload: unknown) {
  const body = (payload && typeof payload === "object" ? payload : {}) as WebhookPayload;
  const nextPayload = JSON.parse(JSON.stringify(body)) as WebhookPayload;
  const channel = await resolvePublicAuthChannelInfo();
  let handledMessages = 0;
  const summaries: string[] = [];

  for (const entry of nextPayload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) {
        continue;
      }

      if (
        !channel.isConfigured ||
        !isSystemChannel(
          {
            displayPhoneNumber: value.metadata?.display_phone_number,
            phoneNumberId: value.metadata?.phone_number_id,
          },
          channel,
        )
      ) {
        continue;
      }

      const remainingMessages: Array<Record<string, unknown>> = [];
      for (const message of value.messages ?? []) {
        const bodyText = extractMessageBody(message);
        const senderPhone = normalizePhone(String(message.from ?? ""));

        if (!senderPhone || !bodyText) {
          remainingMessages.push(message);
          continue;
        }

        const activeIntent =
          (await getLatestActivePublicAuthIntentByPhone(senderPhone)) ??
          (await getLatestRecoverablePublicAuthIntentByPhone(senderPhone));

        if (isOtpCommand(bodyText, Boolean(activeIntent))) {
          const messageId = typeof message.id === "string" ? message.id : "";
          if (isRepeatedWebhookDelivery(messageId)) {
            handledMessages += 1;
            summaries.push(`Duplicate Auth OTP request suppressed for ${senderPhone}`);
            continue;
          }

          const result = await handleIntentOtpRequest(senderPhone);
          if (result.handled) {
            handledMessages += 1;
            summaries.push(result.summary);
            // An authentication command is still a real customer message.
            // Preserve it for the official WhatsApp inbox instead of
            // swallowing it before intake has a chance to create the chat.
            remainingMessages.push(message);
            continue;
          }
        }

        if (senderPhone) {
          const paymentAck = await maybeAcknowledgeManualPaymentMessage(senderPhone);
          if (paymentAck.handled) {
            handledMessages += 1;
            summaries.push(paymentAck.summary);
            remainingMessages.push(message);
            continue;
          }
        }

        remainingMessages.push(message);
      }

      value.messages = remainingMessages;
    }
  }

  return {
    payload: nextPayload,
    handledMessages,
    summaries,
  };
}
