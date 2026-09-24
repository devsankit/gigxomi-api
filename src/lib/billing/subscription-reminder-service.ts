import "server-only";

import { prisma } from "@/lib/prisma";
import { getSubscriptionReminderSettings } from "@/lib/billing/subscription-reminder-settings-service";
import { startManualUpiRenewalPaymentSession } from "@/lib/billing/subscription-service";
import { getWhatsAppConnectionStateFromFile, sendStandaloneWhatsAppCallToActionTemplateFromFile, sendStandaloneWhatsAppMessageFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
  }).format(value);
}

function getFirstName(displayName: string) {
  return displayName.trim().split(/\s+/)[0] || displayName.trim() || "there";
}

function getReminderTargetDate(subscription: {
  nextBillingDate: Date | null;
  renewsAt: Date | null;
  expiresAt: Date | null;
}) {
  return subscription.nextBillingDate ?? subscription.renewsAt ?? subscription.expiresAt;
}

function buildReminderReference(subscriptionId: string, daysBeforeExpiry: number, reminderDate: Date) {
  return `subscription-expiry-reminder:${subscriptionId}:${daysBeforeExpiry}:${startOfDay(reminderDate).toISOString().slice(0, 10)}`;
}

export async function processSubscriptionExpiryReminders(limit = 100) {
  const settings = await getSubscriptionReminderSettings();
  if (!settings.enabled || !settings.reminderDays.length) {
    return {
      processed: 0,
      sent: 0,
      skipped: 0,
      settings,
      results: [] as Array<Record<string, unknown>>,
    };
  }

  const subscriptions = await prisma.userSubscription.findMany({
    where: {
      billingType: "RECURRING",
      provider: "UPI_MANUAL",
      status: { in: ["ACTIVE", "TRIALING"] },
      OR: [
        { nextBillingDate: { not: null } },
        { renewsAt: { not: null } },
        { expiresAt: { not: null } },
      ],
    },
    include: {
      user: true,
      package: true,
    },
    orderBy: [{ nextBillingDate: "asc" }, { renewsAt: "asc" }, { expiresAt: "asc" }],
    take: limit,
  });

  const whatsappConnection = await getWhatsAppConnectionStateFromFile("tenant-gigxomi").catch(() => null);
  const reminderTemplateName =
    whatsappConnection?.renewalReminderTemplateName?.trim() ||
    whatsappConnection?.subscriptionPaymentTemplateName?.trim() ||
    "";
  const reminderTemplateLanguage =
    whatsappConnection?.renewalReminderTemplateLanguage?.trim() ||
    whatsappConnection?.subscriptionPaymentTemplateLanguage?.trim() ||
    "en_US";

  const today = startOfDay(new Date());
  const results: Array<Record<string, unknown>> = [];
  let sent = 0;
  let skipped = 0;

  for (const subscription of subscriptions) {
    const packageName = subscription.package?.name?.trim() || "Gigxomi subscription";
    const currency = subscription.package?.currency || "INR";
    const targetDate = getReminderTargetDate(subscription);
    if (!targetDate) {
      skipped += 1;
      continue;
    }

    const daysBeforeExpiry = Math.round((startOfDay(targetDate).getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (!settings.reminderDays.includes(daysBeforeExpiry)) {
      skipped += 1;
      continue;
    }

    const eventReference = buildReminderReference(subscription.id, daysBeforeExpiry, today);
    const existingEvent = await prisma.recurringBillingEvent.findFirst({
      where: {
        subscriptionId: subscription.id,
        eventType: "STATUS",
        providerReference: eventReference,
      },
      select: { id: true },
    });

    if (existingEvent) {
      skipped += 1;
      continue;
    }

    let paymentSession: Awaited<ReturnType<typeof startManualUpiRenewalPaymentSession>> | null = null;
    try {
      paymentSession = await startManualUpiRenewalPaymentSession({ subscriptionId: subscription.id });
    } catch (error) {
      results.push({
        subscriptionId: subscription.id,
        ok: false,
        step: "prepare-payment",
        error: error instanceof Error ? error.message : "Unable to prepare renewal payment session.",
      });
      skipped += 1;
      continue;
    }

    const paymentUrl = `${(process.env.APP_BASE_URL?.trim() || companyKnowledgeBase.siteUrl).replace(/\/+$/, "")}${paymentSession.redirectUrl}`;
    const firstName = getFirstName(subscription.user.displayName);
    const amountLabel = formatCurrency(Number(subscription.amount), currency);
    const renewalLabel =
      daysBeforeExpiry === 0
        ? "today"
        : daysBeforeExpiry === 1
          ? "tomorrow"
          : `in ${daysBeforeExpiry} days`;
    const fallbackMessage = [
      `Hi ${firstName}, your ${packageName} subscription is due ${renewalLabel}.`,
      `Renewal amount: ${amountLabel}.`,
      `Complete payment here: ${paymentUrl}`,
      `After payment, send the screenshot or UTR on WhatsApp for approval.`,
    ].join("\n\n");

    const delivery =
      reminderTemplateName
        ? await sendStandaloneWhatsAppCallToActionTemplateFromFile({
            tenantId: "tenant-gigxomi",
            to: subscription.user.phone,
            templateName: reminderTemplateName,
            languageCode: reminderTemplateLanguage,
            bodyVariables: [firstName, packageName, amountLabel, formatDate(targetDate)],
            buttonUrlVariable: paymentUrl,
          }).catch((error) => ({
            ok: false,
            mode: "whatsapp-failed" as const,
            error: error instanceof Error ? error.message : "Unable to send WhatsApp reminder template.",
          }))
        : await sendStandaloneWhatsAppMessageFromFile({
            tenantId: "tenant-gigxomi",
            to: subscription.user.phone,
            body: fallbackMessage,
          }).catch((error) => ({
            ok: false,
            mode: "whatsapp-failed" as const,
            error: error instanceof Error ? error.message : "Unable to send WhatsApp reminder.",
          }));

    await prisma.recurringBillingEvent.create({
      data: {
        subscriptionId: subscription.id,
        eventType: "STATUS",
        providerReference: eventReference,
        payload: {
          type: "subscription_expiry_reminder",
          daysBeforeExpiry,
          targetDate: targetDate.toISOString(),
          paymentTransactionId: paymentSession.transactionId,
          paymentReference: paymentSession.paymentReference,
          paymentUrl,
          templateName: reminderTemplateName || null,
          templateLanguage: reminderTemplateLanguage,
          fallbackMessage,
          delivery,
        },
        state: delivery.ok ? delivery.mode : "failed",
        occurredAt: new Date(),
      },
    });

    results.push({
      subscriptionId: subscription.id,
      ok: delivery.ok,
      step: "send-reminder",
      daysBeforeExpiry,
      paymentTransactionId: paymentSession.transactionId,
      deliveryMode: delivery.mode,
      error: "error" in delivery ? delivery.error : null,
    });

    if (delivery.ok) {
      sent += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    processed: results.length,
    sent,
    skipped,
    settings,
    results,
  };
}
