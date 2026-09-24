import "server-only";

import { Prisma } from "@prisma/client";

import { listWhatsAppConnectionStatesFromFile, findChannelConnectionForWhatsAppFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { prisma } from "@/lib/prisma";
import { resolveWhatsAppWebhookConnection } from "@/lib/gigxomi/whatsapp-webhook-tenant-resolver";

type WebhookChangeValue = {
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  messages?: Array<Record<string, unknown>>;
  statuses?: Array<Record<string, unknown>>;
  _gigxomi_tenant_id?: string;
  _gigxomi_channel_connection_id?: string;
};

type WebhookPayload = {
  entry?: Array<{
    id?: string;
    changes?: Array<{ value?: WebhookChangeValue }>;
  }>;
};

function normalizeId(value: unknown) {
  return String(value ?? "").trim();
}

export async function routeAndRecordWhatsAppWebhook(payload: unknown) {
  const cloned = JSON.parse(JSON.stringify(payload && typeof payload === "object" ? payload : {})) as WebhookPayload;
  const connections = await listWhatsAppConnectionStatesFromFile();
  const resolvedMessageIds: string[] = [];
  const unresolvedMessageIds: string[] = [];

  for (const entry of cloned.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = normalizeId(value.metadata?.phone_number_id);
      const wabaId = normalizeId(entry.id);
      const connection = resolveWhatsAppWebhookConnection(connections, value.metadata);

      if (connection) {
        value._gigxomi_tenant_id = connection.tenantId;
        const channelConn = await findChannelConnectionForWhatsAppFromFile({
          phoneNumberId,
          phoneNumber: value.metadata?.display_phone_number,
          wabaId,
          tenantId: connection.tenantId,
        });
        if (channelConn) {
          value._gigxomi_channel_connection_id = channelConn.id;
        }
      }

      const acceptedMessages: Array<Record<string, unknown>> = [];
      for (const message of value.messages ?? []) {
        const messageId = normalizeId(message.id);
        if (!messageId) {
          continue;
        }
        let shouldProcess = false;
        try {
          await prisma.whatsAppWebhookMessageEvent.create({
            data: {
              provider: "whatsapp_cloud_api",
              messageId,
              phoneNumberId: phoneNumberId || null,
              tenantId: connection?.tenantId ?? null,
              agencyId: connection?.tenantId ?? null,
              payloadJson: {
                entryId: wabaId,
                metadata: value.metadata ?? {},
                message,
                routingStatus: connection ? "resolved" : "quarantined",
              } as Prisma.InputJsonValue,
            },
          });
          shouldProcess = Boolean(connection);
          (connection ? resolvedMessageIds : unresolvedMessageIds).push(messageId);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            // Duplicate messageId from Meta retry: drop immediately so in-flight or completed message is NEVER re-executed!
            shouldProcess = false;
          } else {
            throw error;
          }
        }
        if (shouldProcess) {
          acceptedMessages.push(message);
        }
      }

      value.messages = connection ? acceptedMessages : [];
      if (!connection) {
        value.statuses = [];
      }
    }
  }

  return {
    payload: cloned,
    resolvedMessageIds,
    unresolvedMessageIds,
  };
}

export async function markWhatsAppWebhookMessagesProcessed(messageIds: string[]) {
  const ids = Array.from(new Set(messageIds.map(normalizeId).filter(Boolean)));
  if (!ids.length) return;
  await prisma.whatsAppWebhookMessageEvent.updateMany({
    where: { provider: "whatsapp_cloud_api", messageId: { in: ids } },
    data: { processedAt: new Date() },
  });
}
