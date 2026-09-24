import "server-only";

import { revalidatePath, unstable_cache } from "next/cache";

import { randomBytes } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { assertPhonePeCapabilityEnabled } from "@/lib/billing/phonepe-admin-config-service";
import { PhonePeHttpClient, readPhonePeRedirectUrl, readPhonePeReference, readPhonePeState } from "@/lib/billing/phonepe-client";
import { buildPhonePeUrls, getPhonePeConfig } from "@/lib/billing/phonepe-config";
import { prisma } from "@/lib/prisma";

export const GAPP_SUPPORT_PHONE = "9993328124";
export const GAPP_WHATSAPP_CHANNEL_URL = "https://whatsapp.com/channel/0029VaU5fzpLI8YPx1BC4a3b";
export const GAPP_WHATSAPP_COMMUNITY_URL = "https://chat.whatsapp.com/JpH3vS2uTbpAbcgxhMrNab";

const DEFAULT_WEBINAR_ID = "gapp-default-webinar";
const DEFAULT_WEBINAR_SLUG = "gapp";
export const GAPP_SALES_WEBINAR_ID = "agency-growth-webinar";
const UPLOAD_DIRECTORY = path.join(process.cwd(), ".gigxomi", "uploads", "gapp-webinars");

type RegistrationInput = {
  currentMonthlyProjects: string;
  email: string;
  fullName: string;
  participantType: string;
  sourcePath?: string | null;
  userAgent?: string | null;
  whatsappNumber: string;
};

type WebinarUpdateInput = {
  capacity?: number | null;
  countdownEnabled?: boolean;
  currency?: string;
  description?: string;
  meetingLink?: string;
  phonePeEnabled?: boolean;
  priceAmount?: number;
  priceMode?: "FREE" | "PAID";
  registrationEnabled?: boolean;
  scheduledAt?: string;
  title?: string;
};

function defaultScheduledAt() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(20, 0, 0, 0);
  return date;
}

function cleanText(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function makeId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function toMinorUnits(amount: number) {
  return Math.round(amount * 100);
}

function isSuccessState(state: string) {
  return ["COMPLETED", "SUCCESS", "ACTIVE", "AUTHORIZATION_SUCCESSFUL", "EXECUTED"].includes(state.toUpperCase());
}

function isFailureState(state: string) {
  return ["FAILED", "CANCELLED", "EXPIRED", "REVOKED"].includes(state.toUpperCase());
}

function publicWebinarSelect() {
  return {
    capacity: true,
    countdownEnabled: true,
    currency: true,
    description: true,
    id: true,
    meetingLink: true,
    phonePeEnabled: true,
    priceAmount: true,
    priceMode: true,
    registrationEnabled: true,
    scheduledAt: true,
    slug: true,
    thumbnailUrl: true,
    title: true,
    updatedAt: true,
  };
}

function fallbackPublicWebinar() {
  return {
    capacity: null,
    countdownEnabled: true,
    currency: "INR",
    description:
      "Discover how video editors are scaling delivery, managing clients, accessing skilled editors, and growing under their own brand without hiring a huge team.",
    id: DEFAULT_WEBINAR_ID,
    meetingLink: null,
    phonePeEnabled: true,
    priceAmount: 99,
    priceMode: "PAID" as const,
    registrationEnabled: true,
    registrationCount: 0,
    scheduledAt: defaultScheduledAt(),
    slug: DEFAULT_WEBINAR_SLUG,
    thumbnailUrl: null,
    title: "Gigxomi Agency Partnership Program Webinar",
  };
}

function registrationInclude() {
  return {
    payments: {
      orderBy: { createdAt: "desc" as const },
      take: 1,
    },
    webinar: true,
  };
}

export function getPublicGappLinks() {
  return {
    channelUrl: GAPP_WHATSAPP_CHANNEL_URL,
    communityUrl: GAPP_WHATSAPP_COMMUNITY_URL,
    supportPhone: GAPP_SUPPORT_PHONE,
  };
}

async function syncGappWebinarToSales(webinar: {
  description: string;
  registrationEnabled: boolean;
  scheduledAt: Date;
  title: string;
}) {
  const data = {
    description: webinar.description,
    hostId: null,
    isActive: webinar.registrationEnabled,
    registrationLink: "/webinar",
    startsAt: webinar.scheduledAt,
    title: webinar.title,
  };
  await prisma.$transaction([
    prisma.salesWebinar.upsert({
      where: { id: GAPP_SALES_WEBINAR_ID },
      update: data,
      create: { id: GAPP_SALES_WEBINAR_ID, ...data },
    }),
    prisma.salesWebinar.updateMany({
      where: {
        id: { not: GAPP_SALES_WEBINAR_ID },
        isActive: true,
        registrationLink: "/webinar",
      },
      data: { isActive: false },
    }),
  ]);
}

export async function ensureDefaultGappWebinar() {
  const webinar = await prisma.gappWebinar.upsert({
    where: { id: DEFAULT_WEBINAR_ID },
    update: {},
    create: {
      id: DEFAULT_WEBINAR_ID,
      slug: DEFAULT_WEBINAR_SLUG,
      title: "Gigxomi Agency Partnership Program Webinar",
      scheduledAt: defaultScheduledAt(),
      description:
        "Discover how video editors are scaling delivery, managing clients, accessing skilled editors, and growing under their own brand without hiring a huge team.",
      priceMode: "PAID",
      priceAmount: 99,
      currency: "INR",
      phonePeEnabled: true,
      registrationEnabled: true,
      countdownEnabled: true,
    },
  });
  await syncGappWebinarToSales(webinar);
  return webinar;
}

const readActiveGappWebinar = unstable_cache(
  async () => {
    let existing = await prisma.gappWebinar.findFirst({
      where: { slug: DEFAULT_WEBINAR_SLUG },
      select: publicWebinarSelect(),
    });
    if (existing) {
      const newerSalesSchedule = await prisma.salesWebinar.findFirst({
        where: {
          id: { not: GAPP_SALES_WEBINAR_ID },
          isActive: true,
          registrationLink: "/webinar",
          startsAt: { gt: new Date() },
          updatedAt: { gt: existing.updatedAt },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          description: true,
          startsAt: true,
          title: true,
        },
      });
      if (newerSalesSchedule) {
        existing = await prisma.gappWebinar.update({
          where: { id: existing.id },
          data: {
            description: newerSalesSchedule.description || existing.description,
            scheduledAt: newerSalesSchedule.startsAt,
            title: newerSalesSchedule.title,
          },
          select: publicWebinarSelect(),
        });
        await syncGappWebinarToSales(existing);
      }
      return {
        ...existing,
        registrationCount: await countConfirmedRegistrations(existing.id),
      };
    }

    await ensureDefaultGappWebinar();
    const created = await prisma.gappWebinar.findFirst({
      where: { slug: DEFAULT_WEBINAR_SLUG },
      select: publicWebinarSelect(),
    });
    if (!created) return null;
    return {
      ...created,
      registrationCount: await countConfirmedRegistrations(created.id),
    };
  },
  ["active-gapp-webinar"],
  { revalidate: 60 },
);

export async function getActiveGappWebinar() {
  try {
    const webinar = await readActiveGappWebinar();
    if (!webinar) return null;

    // `unstable_cache` persists values through Next's cache serializer. Dates
    // are returned as ISO strings on a cache hit, so revive this field before
    // the server component calls Date methods such as `toISOString()`.
    return {
      ...webinar,
      scheduledAt: new Date(webinar.scheduledAt),
    };
  } catch (error) {
    console.error("[gapp] Falling back to default webinar for public page", error);
    return fallbackPublicWebinar();
  }
}

export async function getGappWebinarAdminView() {
  const webinar = await ensureDefaultGappWebinar();
  const registrations = await prisma.gappWebinarRegistration.findMany({
    where: { webinarId: webinar.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  return {
    webinar,
    registrations,
  };
}

export async function updateGappWebinar(input: WebinarUpdateInput) {
  const webinar = await ensureDefaultGappWebinar();
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const priceAmount = typeof input.priceAmount === "number" && Number.isFinite(input.priceAmount) ? Math.max(0, input.priceAmount) : undefined;
  const capacity = typeof input.capacity === "number" && Number.isFinite(input.capacity) && input.capacity > 0 ? Math.floor(input.capacity) : null;

  const updatedWebinar = await prisma.gappWebinar.update({
    where: { id: webinar.id },
    data: {
      capacity: typeof input.capacity === "undefined" ? undefined : capacity,
      countdownEnabled: typeof input.countdownEnabled === "boolean" ? input.countdownEnabled : undefined,
      currency: input.currency ? cleanText(input.currency, 8).toUpperCase() : undefined,
      description: input.description ? cleanText(input.description, 1000) : undefined,
      meetingLink: typeof input.meetingLink === "string" ? input.meetingLink.trim().slice(0, 500) || null : undefined,
      phonePeEnabled: typeof input.phonePeEnabled === "boolean" ? input.phonePeEnabled : undefined,
      priceAmount,
      priceMode: input.priceMode === "FREE" || input.priceMode === "PAID" ? input.priceMode : undefined,
      registrationEnabled: typeof input.registrationEnabled === "boolean" ? input.registrationEnabled : undefined,
      scheduledAt: scheduledAt && Number.isFinite(scheduledAt.getTime()) ? scheduledAt : undefined,
      title: input.title ? cleanText(input.title, 180) : undefined,
    },
  });
  await syncGappWebinarToSales(updatedWebinar);
  revalidatePath("/", "page");
  return updatedWebinar;
}

export async function saveGappWebinarThumbnail(input: { fileBuffer: ArrayBuffer; fileName: string; mimeType: string; webinarId: string }) {
  const safeName = cleanText(input.fileName, 120).replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-") || "thumbnail";
  const extension = path.extname(safeName) || (input.mimeType.includes("png") ? ".png" : ".jpg");
  const fileName = `${input.webinarId}-${Date.now()}${extension}`;
  const filePath = path.join(UPLOAD_DIRECTORY, fileName);
  await mkdir(UPLOAD_DIRECTORY, { recursive: true });
  await writeFile(filePath, Buffer.from(input.fileBuffer));

  return prisma.gappWebinar.update({
    where: { id: input.webinarId },
    data: {
      thumbnailStoragePath: filePath,
      thumbnailUrl: `/api/gapp/webinar/thumbnail/${encodeURIComponent(input.webinarId)}`,
    },
  });
}

export async function readGappWebinarThumbnail(webinarId: string) {
  const webinar = await prisma.gappWebinar.findUnique({
    where: { id: webinarId },
    select: { thumbnailStoragePath: true },
  });
  if (!webinar?.thumbnailStoragePath) return null;
  const bytes = await readFile(webinar.thumbnailStoragePath).catch(() => null);
  return bytes ? { bytes } : null;
}

export function validateGappRegistration(input: RegistrationInput) {
  const fullName = cleanText(input.fullName, 120);
  const whatsappNumber = normalizePhone(input.whatsappNumber);
  const email = cleanText(input.email, 160).toLowerCase();
  const participantType = cleanText(input.participantType, 80);
  const currentMonthlyProjects = cleanText(input.currentMonthlyProjects, 80);

  if (fullName.length < 2) return { ok: false as const, error: "Enter your full name." };
  if (!/^\+\d{10,15}$/.test(whatsappNumber)) return { ok: false as const, error: "Enter a valid WhatsApp number." };
  if (!isEmail(email)) return { ok: false as const, error: "Enter a valid email address." };
  if (!participantType) return { ok: false as const, error: "Choose whether you are a freelancer or agency." };
  if (!currentMonthlyProjects) return { ok: false as const, error: "Choose your current monthly projects." };

  return {
    ok: true as const,
    data: {
      currentMonthlyProjects,
      email,
      fullName,
      participantType,
      sourcePath: input.sourcePath?.trim() || null,
      userAgent: input.userAgent?.trim() || null,
      whatsappNumber,
    },
  };
}

async function countRegistrations(webinarId: string) {
  return prisma.gappWebinarRegistration.count({
    where: {
      webinarId,
      status: { in: ["REGISTERED", "PAYMENT_PENDING", "PAYMENT_SUCCESS"] },
    },
  });
}

async function countConfirmedRegistrations(webinarId: string) {
  return prisma.gappWebinarRegistration.count({
    where: {
      webinarId,
      status: { in: ["REGISTERED", "PAYMENT_SUCCESS"] },
    },
  });
}

async function createPhonePeCheckout(input: {
  amount: number;
  currency: string;
  email: string;
  fullName: string;
  phone: string;
  registrationId: string;
  webinarId: string;
}) {
  await assertPhonePeCapabilityEnabled("one_time");
  const config = getPhonePeConfig();
  const urls = buildPhonePeUrls();
  const merchantOrderId = makeId("gapp-order");
  const merchantTransactionId = merchantOrderId;
  const payload = {
    merchantId: config.merchantId,
    merchantOrderId,
    merchantTransactionId,
    amount: toMinorUnits(input.amount),
    currency: input.currency,
    redirectUrl: `${urls.paymentReturnUrl.replace("/api/payments/phonepe/return", "/api/gapp/webinar/payment/return")}?merchantTransactionId=${encodeURIComponent(
      merchantTransactionId,
    )}`,
    redirectMode: "REDIRECT",
    callbackUrl: urls.paymentWebhookUrl.replace("/api/payments/phonepe/webhook", "/api/gapp/webinar/payment/webhook"),
    metaInfo: {
      email: input.email,
      phone: input.phone,
      registrationId: input.registrationId,
      userName: input.fullName,
      webinarId: input.webinarId,
    },
    paymentFlow: {
      type: "PG_CHECKOUT",
    },
  };

  await prisma.gappWebinarPayment.create({
    data: {
      amount: input.amount,
      currency: input.currency,
      merchantOrderId,
      merchantTransactionId,
      rawRequest: payload,
      registrationId: input.registrationId,
      status: "PENDING",
    },
  });

  const raw = await new PhonePeHttpClient().request("/checkout/v2/pay", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const redirectUrl = readPhonePeRedirectUrl(raw);
  if (!redirectUrl) throw new Error("PhonePe did not return a checkout redirect URL.");

  await prisma.gappWebinarPayment.update({
    where: { merchantTransactionId },
    data: {
      rawResponse: raw as object,
      redirectUrl,
      status: "INITIATED",
    },
  });

  return { merchantTransactionId, redirectUrl };
}

export async function registerForGappWebinar(input: RegistrationInput) {
  const webinar = await ensureDefaultGappWebinar();
  if (!webinar.registrationEnabled) {
    return { ok: false as const, error: "Registration is closed for this batch." };
  }
  if (webinar.capacity && (await countRegistrations(webinar.id)) >= webinar.capacity) {
    return { ok: false as const, error: "This batch is full. Please contact support for the next batch." };
  }

  const validation = validateGappRegistration(input);
  if (!validation.ok) return validation;

  const isPaid = webinar.priceMode === "PAID" && Number(webinar.priceAmount) > 0;
  const registration = await prisma.gappWebinarRegistration.create({
    data: {
      ...validation.data,
      status: isPaid ? "PAYMENT_PENDING" : "REGISTERED",
      webinarId: webinar.id,
    },
  });

  if (!isPaid) {
    return {
      ok: true as const,
      registrationId: registration.id,
      redirectUrl: `/webinar/thank-you/${registration.id}`,
    };
  }

  if (!webinar.phonePeEnabled) {
    await prisma.gappWebinarRegistration.update({
      where: { id: registration.id },
      data: { status: "PAYMENT_FAILED" },
    });
    return { ok: false as const, error: "Paid registration is not available right now. Please contact support." };
  }

  try {
    const payment = await createPhonePeCheckout({
      amount: Number(webinar.priceAmount),
      currency: webinar.currency,
      email: registration.email,
      fullName: registration.fullName,
      phone: registration.whatsappNumber,
      registrationId: registration.id,
      webinarId: webinar.id,
    });

    return {
      ok: true as const,
      merchantTransactionId: payment.merchantTransactionId,
      registrationId: registration.id,
      redirectUrl: payment.redirectUrl,
    };
  } catch (error) {
    await prisma.gappWebinarRegistration.update({
      where: { id: registration.id },
      data: { status: "PAYMENT_FAILED" },
    });
    throw error;
  }
}

export async function verifyGappPayment(merchantTransactionId: string) {
  const payment = await prisma.gappWebinarPayment.findFirst({
    where: { OR: [{ merchantTransactionId }, { merchantOrderId: merchantTransactionId }] },
    include: { registration: true },
  });
  if (!payment) throw new Error("GAPP payment was not found.");

  const raw = await new PhonePeHttpClient().request(`/checkout/v2/order/${encodeURIComponent(merchantTransactionId)}/status`, { method: "GET" });
  const state = readPhonePeState(raw);
  const status = isSuccessState(state) ? "SUCCESS" : isFailureState(state) ? "FAILED" : "INITIATED";

  await prisma.gappWebinarPayment.update({
    where: { id: payment.id },
    data: {
      rawResponse: raw as object,
      status,
      paidAt: status === "SUCCESS" ? new Date() : undefined,
    },
  });
  await prisma.gappWebinarRegistration.update({
    where: { id: payment.registrationId },
    data: {
      status: status === "SUCCESS" ? "PAYMENT_SUCCESS" : status === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_PENDING",
    },
  });

  return { registrationId: payment.registrationId, state, status };
}

function readPayloadString(value: unknown, keys: string[]) {
  let current: unknown = value;
  for (const key of keys) current = current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined;
  return typeof current === "string" ? current : "";
}

export async function processGappPaymentWebhook(payload: unknown) {
  const merchantTransactionId =
    readPayloadString(payload, ["merchantTransactionId"]) ||
    readPayloadString(payload, ["payload", "merchantTransactionId"]) ||
    readPayloadString(payload, ["data", "merchantTransactionId"]) ||
    readPayloadString(payload, ["merchantOrderId"]) ||
    readPayloadString(payload, ["payload", "merchantOrderId"]);
  const state = readPayloadString(payload, ["payload", "state"]) || readPayloadString(payload, ["state"]) || readPayloadString(payload, ["code"]) || "UNKNOWN";
  if (!merchantTransactionId) return { ok: true, ignored: true };

  const payment = await prisma.gappWebinarPayment.findFirst({
    where: { OR: [{ merchantTransactionId }, { merchantOrderId: merchantTransactionId }] },
  });
  if (!payment) return { ok: true, ignored: true };
  if (payment.status === "SUCCESS") return { ok: true, duplicate: true };

  const status = isSuccessState(state) ? "SUCCESS" : isFailureState(state) ? "FAILED" : "INITIATED";
  await prisma.gappWebinarPayment.update({
    where: { id: payment.id },
    data: {
      rawResponse: payload as object,
      status,
      paidAt: status === "SUCCESS" ? new Date() : undefined,
    },
  });
  await prisma.gappWebinarRegistration.update({
    where: { id: payment.registrationId },
    data: {
      status: status === "SUCCESS" ? "PAYMENT_SUCCESS" : status === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_PENDING",
    },
  });

  return { ok: true };
}

export async function getGappRegistrationForThankYou(registrationId: string) {
  const registration = await prisma.gappWebinarRegistration.findUnique({
    where: { id: registrationId },
    include: registrationInclude(),
  });
  if (!registration) return null;
  const canJoin = registration.status === "REGISTERED" || registration.status === "PAYMENT_SUCCESS";
  return { canJoin, registration };
}

export async function exportGappRegistrationsCsv(webinarId: string) {
  const rows = await prisma.gappWebinarRegistration.findMany({
    where: { webinarId },
    orderBy: { createdAt: "desc" },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const header = ["Name", "WhatsApp", "Email", "Type", "Monthly Projects", "Status", "Payment Status", "Registered At"];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    header.map(escape).join(","),
    ...rows.map((row) =>
      [
        row.fullName,
        row.whatsappNumber,
        row.email,
        row.participantType,
        row.currentMonthlyProjects,
        row.status,
        row.payments[0]?.status ?? "",
        row.createdAt.toISOString(),
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
}

export async function listGappRegistrationsForFollowUp(limit = 100) {
  const webinar = await ensureDefaultGappWebinar();
  const registrations = await prisma.gappWebinarRegistration.findMany({
    where: { webinarId: webinar.id },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 500)),
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  return {
    webinar,
    registrations,
  };
}

export function readPhonePeWebhookReference(payload: unknown) {
  return readPhonePeReference(payload);
}
