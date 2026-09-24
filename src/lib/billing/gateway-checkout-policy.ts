export type GatewayPaymentKind = "AUTOPAY" | "ONE_TIME";
export type GatewayCycle = "MONTHLY" | "YEARLY";

export function paidPeriodEnd(start: Date, cycle: GatewayCycle) {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (cycle === "YEARLY" ? 12 : 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Provider order IDs and merchant order IDs are different identifiers. */
export function assertGatewayProof(input: {
  raw: unknown; merchantOrderId: string; providerOrderId?: string | null;
  amount: number; userId: string; subscriptionId: string; packageId: string; cycle: string;
}) {
  const raw = record(input.raw);
  if (raw.state !== "COMPLETED") throw new Error("Payment confirmation is pending.");
  if (typeof raw.amount !== "number" || !Number.isSafeInteger(raw.amount) || raw.amount !== Math.round(input.amount * 100)) {
    throw new Error("PhonePe payment amount verification failed.");
  }
  if (raw.merchantOrderId && raw.merchantOrderId !== input.merchantOrderId) throw new Error("PhonePe merchant order mismatch.");
  if (input.providerOrderId && raw.orderId !== input.providerOrderId) throw new Error("PhonePe provider order mismatch.");
  const meta = record(raw.metaInfo);
  for (const [key, expected] of [["udf1", input.userId], ["udf2", input.subscriptionId], ["udf3", input.packageId], ["udf5", input.cycle]]) {
    if (meta[key] != null && meta[key] !== expected) throw new Error("PhonePe payment metadata mismatch.");
  }
  if (!["MONTHLY", "YEARLY"].includes(input.cycle)) throw new Error("PhonePe payment billing cycle verification failed.");
}

export function checkoutTerminal(status: string) {
  return ["EXPIRED", "CANCELLED", "REVOKED", "FAILED"].includes(status);
}
