import "server-only";

import { prisma } from "@/lib/prisma";
import { buildBillingInvoicePdf, type BillingInvoicePdfInput } from "@/lib/billing/invoice-pdf";
import { sendStandaloneWhatsAppDocumentFromFile } from "@/lib/gigxomi/dummy-platform-file-store";

const DEFAULT_TENANT_ID = "tenant-gigxomi";
const RECEIPT_SENT_EVENT = "phonepe_receipt_whatsapp_sent";
const RECEIPT_FAILED_EVENT = "phonepe_receipt_whatsapp_failed";
const RECEIPT_SKIPPED_EVENT = "phonepe_receipt_whatsapp_skipped";

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return Number(value) || 0;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value ?? 0) || 0;
}

function compactId(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function buildInvoiceNumber(transaction: { id: string; paidAt: Date | null; createdAt: Date }) {
  const issuedAt = transaction.paidAt ?? transaction.createdAt;
  const datePart = issuedAt.toISOString().slice(0, 10).replace(/-/g, "");
  const idPart = compactId(transaction.id).slice(-8) || "RECEIPT";
  return `GXINV-${datePart}-${idPart}`;
}

function buildFileName(invoiceNumber: string) {
  return `gigxomi-invoice-${compactId(invoiceNumber).toLowerCase()}.pdf`;
}

function formatProvider(provider: string) {
  return provider.toUpperCase() === "PHONEPE" ? "PhonePe" : provider.replace(/_/g, " ");
}

export async function getBillingInvoice(transactionId: string) {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id: transactionId },
    include: {
      package: true,
      subscription: true,
      user: true,
    },
  });

  if (!transaction) {
    throw new Error("Payment transaction not found.");
  }

  if (transaction.status !== "SUCCESS") {
    throw new Error("Invoice is available only after successful payment.");
  }

  const invoiceNumber = buildInvoiceNumber(transaction);
  const issuedAt = transaction.paidAt ?? transaction.updatedAt ?? transaction.createdAt;
  const amount = toNumber(transaction.amount);
  const input: BillingInvoicePdfInput = {
    invoiceNumber,
    issuedAt,
    customerName: transaction.user.displayName,
    customerPhone: transaction.user.phone,
    customerEmail: transaction.user.email,
    packageName: transaction.package.name,
    description: `${transaction.package.name} subscription`,
    amount,
    currency: transaction.currency || "INR",
    expiresAt: transaction.subscription?.expiresAt ?? transaction.user.packageExpiresAt ?? null,
    provider: formatProvider(transaction.provider),
    merchantOrderId: transaction.merchantOrderId ?? transaction.merchantTransactionId,
    transactionId: transaction.transactionId ?? transaction.id,
  };

  const pdf = buildBillingInvoicePdf(input);
  return {
    transaction,
    invoiceNumber,
    fileName: buildFileName(invoiceNumber),
    mimeType: "application/pdf",
    pdf,
    input,
  };
}

export async function sendPaymentReceiptWhatsApp(transactionId: string) {
  const alreadySent = await prisma.paymentLog.findFirst({
    where: { transactionId, eventType: RECEIPT_SENT_EVENT },
    orderBy: { createdAt: "desc" },
  });

  if (alreadySent) {
    return { ok: true, skipped: true, reason: "receipt_already_sent" };
  }

  const invoice = await getBillingInvoice(transactionId);
  const userPhone = invoice.transaction.user.phone?.trim();

  if (!userPhone) {
    await prisma.paymentLog.create({
      data: {
        transactionId,
        eventType: RECEIPT_SKIPPED_EVENT,
        status: "missing_phone",
        payload: {
          invoiceNumber: invoice.invoiceNumber,
          fileName: invoice.fileName,
        },
      },
    });
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const caption = [
    `Hi ${invoice.transaction.user.displayName}, your Gigxomi payment is complete.`,
    `Invoice: ${invoice.invoiceNumber}`,
    `Package: ${invoice.transaction.package.name}`,
  ].join("\n");

  const delivery = await sendStandaloneWhatsAppDocumentFromFile({
    tenantId: invoice.transaction.user.tenantId ?? DEFAULT_TENANT_ID,
    to: userPhone,
    body: caption,
    fileName: invoice.fileName,
    mimeType: invoice.mimeType,
    bytes: invoice.pdf,
  }).catch((error) => ({
    ok: false,
    mode: "whatsapp-failed" as const,
    error: error instanceof Error ? error.message : "WhatsApp receipt send failed.",
  }));

  await prisma.paymentLog.create({
    data: {
      transactionId,
      eventType: delivery.ok ? RECEIPT_SENT_EVENT : RECEIPT_FAILED_EVENT,
      status: delivery.ok ? delivery.mode : "failed",
      payload: {
        invoiceNumber: invoice.invoiceNumber,
        fileName: invoice.fileName,
        bytes: invoice.pdf.byteLength,
        delivery,
      },
    },
  });

  return {
    ok: delivery.ok,
    invoiceNumber: invoice.invoiceNumber,
    fileName: invoice.fileName,
    delivery,
  };
}
