import { NextResponse } from "next/server";

import { getConversationViewForSession } from "@/lib/api/conversation-view-response";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { updateConversationLeadStatusFromFile } from "@/lib/gigxomi/dummy-platform-file-store";
import { syncLeadStatusToMetaAndOutbox } from "@/lib/gigxomi/lead-status-meta-sync";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER", "SALES_AGENT"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await context.params;
  const body = await request.json();
  if (!(await getConversationViewForSession(authorization.session, id))) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
  }

  const notes = typeof body.notes === "string" ? body.notes : typeof body.internalNotes === "string" ? body.internalNotes : undefined;
  const leadStatusId = body.leadStatusId ? String(body.leadStatusId).trim() : undefined;
  const extras = {
    dueDate: body.dueDate !== undefined ? (body.dueDate ? String(body.dueDate).trim() : null) : undefined,
    isPrivate: body.isPrivate !== undefined ? Boolean(body.isPrivate) : undefined,
  };

  if (process.env.DATABASE_URL?.trim()) {
    try {
      const existingDb = await prisma.appConversation.findUnique({ where: { id } });
      if (existingDb) {
        const currentPayload = existingDb.payload && typeof existingDb.payload === "object" && !Array.isArray(existingDb.payload)
          ? (existingDb.payload as Record<string, unknown>)
          : {};
        const updatedPayload = {
          ...currentPayload,
          ...(leadStatusId ? { leadStatusId } : {}),
          ...(typeof notes === "string" ? { internalNotes: notes } : {}),
          ...(extras.dueDate !== undefined ? { dueDate: extras.dueDate } : {}),
          ...(extras.isPrivate !== undefined ? { isPrivate: extras.isPrivate } : {}),
          updatedAt: new Date().toISOString(),
        };
        await prisma.appConversation.update({
          where: { id },
          data: {
            ...(leadStatusId ? { leadStatusId } : {}),
            payload: updatedPayload,
            updatedAt: new Date(),
          },
        });
      }
    } catch (err) {
      console.error("Prisma appConversation lead status direct update error:", err);
    }
  }

  const conversation = await updateConversationLeadStatusFromFile(id, leadStatusId, notes, extras);

  // Synchronize conversion to Meta CAPI & Realtime SSE
  const syncResult = await syncLeadStatusToMetaAndOutbox({
    conversationId: id,
    leadStatusId: leadStatusId ?? "",
    notes,
    actorUserId: authorization.session.userId,
  });

  const conversationView = await getConversationViewForSession(authorization.session, id);
  if (!conversation && !conversationView) {
    return NextResponse.json({ ok: false, error: "Unable to update lead status" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    conversation: conversationView,
    meta: syncResult.meta,
  });
}
