import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { findRegistrationPackage } from "@/lib/gigxomi/public-growth-store";

function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || "";

  return { keyId, keySecret, webhookSecret };
}

export function isRazorpayConfigured(): boolean {
  const { keyId, keySecret } = getRazorpayConfig();
  return Boolean(keyId && keySecret);
}

export function getRazorpayKeyId(): string {
  const { keyId } = getRazorpayConfig();
  return keyId;
}

function getBasicAuthHeader(keyId: string, keySecret: string) {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

export async function createRazorpayOrder(input: {
  userId: string;
  packageId: string;
  billingCycle: "MONTHLY" | "YEARLY";
  couponCode?: string;
}) {
  const { keyId, keySecret } = getRazorpayConfig();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured yet. Please configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }

  const user = await prisma.appAuthUser.findUnique({ where: { id: input.userId } });
  if (!user) {
    throw new Error("User not found.");
  }

  const pkg = await findRegistrationPackage(input.packageId);
  if (!pkg || !pkg.isActive) {
    throw new Error("Selected package is not available.");
  }

  const cycleAmount = input.billingCycle === "YEARLY" ? pkg.priceYearly : pkg.priceMonthly;
  const amountInRupees = Number(cycleAmount) || (input.billingCycle === "YEARLY" ? 17700 : 2000);
  const amountInPaise = Math.round(amountInRupees * 100);

  const receipt = `rcpt_${input.userId.slice(-8)}_${Date.now().toString().slice(-6)}`;

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getBasicAuthHeader(keyId, keySecret),
    },
    body: JSON.stringify({
      amount: amountInPaise,
      currency: "INR",
      receipt,
      notes: {
        userId: input.userId,
        packageId: pkg.id,
        packageName: pkg.name,
        billingCycle: input.billingCycle,
        userPhone: user.phone || "",
        userEmail: user.email || "",
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[RAZORPAY] Order creation failed:", errorBody);
    throw new Error(`Razorpay order creation failed: ${response.statusText}`);
  }

  const order = (await response.json()) as { id: string; amount: number; currency: string; receipt: string };

  // Create or record pending transaction in database
  await prisma.paymentTransaction.create({
    data: {
      userId: input.userId,
      packageId: pkg.id,
      amount: amountInRupees,
      currency: "INR",
      transactionType: "ONE_TIME",
      provider: "UPI_MANUAL",
      merchantTransactionId: order.id,
      merchantOrderId: order.id,
      status: "INITIATED",
      rawRequest: { orderId: order.id, billingCycle: input.billingCycle },
    },
  }).catch(() => undefined);

  return {
    orderId: order.id,
    amount: amountInPaise,
    currency: "INR",
    keyId,
    packageName: pkg.name,
    billingCycle: input.billingCycle,
    amountInRupees,
    prefill: {
      name: user.displayName || "",
      email: user.email || "",
      contact: user.phone ? user.phone.replace(/[^\d+]/g, "") : "",
    },
  };
}

export function verifyRazorpayPaymentSignature(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): boolean {
  const { keySecret } = getRazorpayConfig();
  if (!keySecret) return false;

  const body = `${input.razorpay_order_id}|${input.razorpay_payment_id}`;
  const expectedSignature = createHmac("sha256", keySecret).update(body).digest("hex");
  return expectedSignature === input.razorpay_signature;
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  const { webhookSecret, keySecret } = getRazorpayConfig();
  const secret = webhookSecret || keySecret;
  if (!secret) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return expected === signature;
}

export async function activateSubscriptionFromRazorpay(input: {
  userId: string;
  packageId: string;
  billingCycle: "MONTHLY" | "YEARLY";
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountInRupees: number;
}) {
  const pkg = await findRegistrationPackage(input.packageId);
  if (!pkg) {
    throw new Error(`Package ${input.packageId} not found.`);
  }

  const durationDays = input.billingCycle === "YEARLY" ? 365 : 30;
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // 1. Update Payment Transaction to SUCCESS
  await prisma.paymentTransaction.upsert({
    where: { merchantOrderId: input.razorpayOrderId },
    create: {
      userId: input.userId,
      packageId: pkg.id,
      amount: input.amountInRupees,
      currency: "INR",
      transactionType: "ONE_TIME",
      provider: "UPI_MANUAL",
      merchantOrderId: input.razorpayOrderId,
      merchantTransactionId: input.razorpayOrderId,
      status: "SUCCESS",
      rawResponse: {
        orderId: input.razorpayOrderId,
        paymentId: input.razorpayPaymentId,
        billingCycle: input.billingCycle,
        activatedAt: startsAt.toISOString(),
      },
    },
    update: {
      status: "SUCCESS",
      rawResponse: {
        orderId: input.razorpayOrderId,
        paymentId: input.razorpayPaymentId,
        billingCycle: input.billingCycle,
        activatedAt: startsAt.toISOString(),
      },
    },
  }).catch(() => undefined);

  // 2. Create or Update UserSubscription to ACTIVE
  const userSub = await prisma.userSubscription.findFirst({
    where: { userId: input.userId },
    orderBy: { createdAt: "desc" },
  });

  if (userSub) {
    await prisma.userSubscription.update({
      where: { id: userSub.id },
      data: {
        packageId: pkg.id,
        status: "ACTIVE",
        paymentStatus: "PAID",
        billingInterval: input.billingCycle,
        startsAt,
        expiresAt,
        subscriptionState: "RAZORPAY_ACTIVE",
      },
    });
  } else {
    await prisma.userSubscription.create({
      data: {
        userId: input.userId,
        packageId: pkg.id,
        packageType: (pkg as unknown as { packageType?: any }).packageType ?? "FREELANCER",
        provider: "UPI_MANUAL",
        status: "ACTIVE",
        paymentStatus: "PAID",
        billingType: "ONE_TIME_PAID",
        billingInterval: input.billingCycle,
        amount: input.amountInRupees,
        startsAt,
        expiresAt,
        subscriptionState: "RAZORPAY_ACTIVE",
      },
    });
  }

  // 3. Sync User Profile & Permissions
  const assignedRole = pkg.audience === "AGENCY" ? "ADMIN" : "FREELANCER";
  const currentUser = await prisma.appAuthUser.findUnique({ where: { id: input.userId } });
  const tenantId =
    pkg.audience === "AGENCY"
      ? currentUser?.tenantId && currentUser.tenantId !== "tenant_default"
        ? currentUser.tenantId
        : `tenant-agency-${randomBytes(4).toString("hex")}`
      : "tenant_default";

  const updatedUser = await prisma.appAuthUser.update({
    where: { id: input.userId },
    data: {
      assignedRole,
      role: assignedRole,
      tenantId,
      packageId: pkg.id,
      packageName: pkg.name,
      packageAudience: pkg.audience,
      packageStatus: "ACTIVE",
      packageExpiresAt: expiresAt,
      workspaceMode: pkg.audience === "AGENCY" ? "AGENCY" : "FREELANCER",
      permissions: [assignedRole.toLowerCase()],
    },
  });

  // 4. Update Onboarding state if needed
  await prisma.connectedOnboardingState.updateMany({
    where: { userId: input.userId },
    data: { activatedAt: startsAt, stage: "PROFILE" },
  }).catch(() => undefined);

  console.log(`[RAZORPAY] Successfully activated ${pkg.name} (${input.billingCycle}) for user ${input.userId}`);
  return { ok: true, user: updatedUser, pkg };
}

export async function createRazorpayPaymentLink(input: {
  userId: string;
  packageId: string;
  billingCycle: "MONTHLY" | "YEARLY";
  couponCode?: string;
  returnTarget?: string;
}) {
  const { keyId, keySecret } = getRazorpayConfig();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured yet. Please configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }

  const user = await prisma.appAuthUser.findUnique({ where: { id: input.userId } });
  if (!user) {
    throw new Error("User not found.");
  }

  const pkg = await findRegistrationPackage(input.packageId);
  if (!pkg || !pkg.isActive) {
    throw new Error("Selected package is not available.");
  }

  const cycleAmount = input.billingCycle === "YEARLY" ? pkg.priceYearly : pkg.priceMonthly;
  const amountInRupees = Number(cycleAmount) || (input.billingCycle === "YEARLY" ? 17700 : 2000);
  const amountInPaise = Math.round(amountInRupees * 100);

  const callbackUrl = "https://www.gigxomi.com/mobile/billing-return?status=success";

  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getBasicAuthHeader(keyId, keySecret),
    },
    body: JSON.stringify({
      amount: amountInPaise,
      currency: "INR",
      accept_partial: false,
      description: `Gigxomi ${pkg.name} - ${input.billingCycle === "YEARLY" ? "Yearly" : "Monthly"} Subscription`,
      customer: {
        name: user.displayName || "Agency Owner",
        email: user.email || "billing@gigxomi.com",
        contact: user.phone ? user.phone.replace(/[^\d+]/g, "") : "+919876543210",
      },
      notify: { sms: false, email: false, whatsapp: false },
      reminder_enable: false,
      notes: {
        userId: input.userId,
        packageId: pkg.id,
        packageName: pkg.name,
        billingCycle: input.billingCycle,
        returnTarget: input.returnTarget || "DIRECT_ANDROID",
      },
      callback_url: callbackUrl,
      callback_method: "get",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[RAZORPAY] Payment link creation failed:", errorBody);
    throw new Error(`Razorpay payment link creation failed: ${response.statusText}`);
  }

  const plink = (await response.json()) as { id: string; short_url: string; amount: number };

  await prisma.paymentTransaction.create({
    data: {
      userId: input.userId,
      packageId: pkg.id,
      amount: amountInRupees,
      currency: "INR",
      transactionType: "ONE_TIME",
      provider: "UPI_MANUAL",
      merchantTransactionId: plink.id,
      merchantOrderId: plink.id,
      status: "INITIATED",
      rawRequest: { plinkId: plink.id, shortUrl: plink.short_url, billingCycle: input.billingCycle },
    },
  }).catch(() => undefined);

  return {
    id: plink.id,
    paymentUrl: plink.short_url,
    amountInRupees,
    packageName: pkg.name,
  };
}
