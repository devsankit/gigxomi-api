import "server-only";

import { NextResponse } from "next/server";

import { requireSessionRole } from "@/lib/api/require-session-role";
import { prisma } from "@/lib/prisma";

const BILLING_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES_AGENT", "FREELANCER"] as const;

function forbidden() {
  return NextResponse.json({ ok: false, error: "You do not have access to this billing record." }, { status: 403 });
}

function notFound() {
  return NextResponse.json({ ok: false, error: "Billing record not found." }, { status: 404 });
}

export async function requirePaymentReferenceOwner(reference: string) {
  const authorization = await requireSessionRole([...BILLING_ROLES]);
  if (!authorization.ok) return authorization;

  const transaction = await prisma.paymentTransaction.findFirst({
    where: { OR: [{ merchantTransactionId: reference }, { merchantOrderId: reference }] },
    select: { id: true, userId: true, packageId: true, status: true, subscriptionId: true },
  });
  if (!transaction) return { ok: false as const, response: notFound() };
  if (authorization.session.role !== "SUPER_ADMIN" && transaction.userId !== authorization.session.userId) {
    return { ok: false as const, response: forbidden() };
  }

  return { ok: true as const, session: authorization.session, transaction };
}

export async function requireSubscriptionReferenceOwner(reference: string) {
  const authorization = await requireSessionRole([...BILLING_ROLES]);
  if (!authorization.ok) return authorization;

  const subscription = await prisma.userSubscription.findUnique({
    where: { merchantSubscriptionId: reference },
    select: { id: true, userId: true, packageId: true, status: true },
  });
  if (!subscription) return { ok: false as const, response: notFound() };
  if (authorization.session.role !== "SUPER_ADMIN" && subscription.userId !== authorization.session.userId) {
    return { ok: false as const, response: forbidden() };
  }

  return { ok: true as const, session: authorization.session, subscription };
}
