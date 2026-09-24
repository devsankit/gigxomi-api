import { NextResponse } from "next/server";

import { resolveSessionTenantId } from "@/lib/api/resolve-session-tenant";
import { requireSessionRole } from "@/lib/api/require-session-role";
import {
  createContactFromFile,
  listContactsFromFile,
  listLeadStatusesFromFile,
  listManagersFromFile,
  updateContactFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const audience = authorization.session.role === "MANAGER" ? "manager" : "admin";
  const tenantId =
    authorization.session.role === "SUPER_ADMIN"
      ? undefined
      : resolveSessionTenantId(authorization.session);

  const [contacts, statuses, managers, memberships] = await Promise.all([
    listContactsFromFile(audience, tenantId),
    listLeadStatusesFromFile(),
    listManagersFromFile(tenantId),
    prisma.appTeamMembership.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status: "ACTIVE",
      },
      select: {
        id: true,
        freelancerId: true,
        freelancerName: true,
        roleType: true,
      },
    }).catch(() => []),
  ]);

  const teamEditors = memberships.map((m) => ({
    id: m.freelancerId || m.id,
    name: m.freelancerName,
  }));

  return NextResponse.json({
    ok: true,
    contacts,
    statuses,
    managers,
    teamEditors,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  if (!authorization.ok) {
    return authorization.response;
  }

  const audience = authorization.session.role === "MANAGER" ? "manager" : "admin";
  const tenantId =
    authorization.session.role === "SUPER_ADMIN"
      ? undefined
      : resolveSessionTenantId(authorization.session);

  const body = await request.json();

  if (body.action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!name || !phone) {
      return NextResponse.json({ ok: false, error: "Name and phone are required" }, { status: 400 });
    }

    const newContact = await createContactFromFile(
      {
        name,
        phone,
        email: typeof body.email === "string" ? body.email.trim() : undefined,
        currentService: typeof body.currentService === "string" ? body.currentService.trim() : "Video Editing",
        notes: typeof body.notes === "string" ? body.notes.trim() : "",
        assignedUserId: typeof body.assignedUserId === "string" ? body.assignedUserId.trim() : undefined,
        latestStatusId: typeof body.latestStatusId === "string" ? body.latestStatusId.trim() : "open",
      },
      tenantId
    );

    return NextResponse.json({
      ok: true,
      contact: newContact,
      contacts: await listContactsFromFile(audience, tenantId),
      managers: await listManagersFromFile(tenantId),
    });
  }

  const contact = await updateContactFromFile(body.contactId ?? "", {
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    latestStatusId: typeof body.latestStatusId === "string" ? body.latestStatusId : undefined,
    assignedUserId: typeof body.assignedUserId === "string" ? body.assignedUserId : undefined,
  }, tenantId);

  if (!contact) {
    return NextResponse.json({ ok: false, error: "Contact not found" }, { status: 404 });
  }

  if (process.env.DATABASE_URL?.trim()) {
    try {
      const conv = await prisma.appConversation.findFirst({
        where: {
          OR: [
            ...(contact.conversationId ? [{ id: contact.conversationId }] : []),
            ...(contact.phone ? [{ customerPhone: contact.phone }] : []),
          ],
        },
      });
      if (conv) {
        const currentPayload = conv.payload && typeof conv.payload === "object" && !Array.isArray(conv.payload)
          ? (conv.payload as Record<string, unknown>)
          : {};
        const updatedPayload = {
          ...currentPayload,
          ...(typeof body.notes === "string" ? { internalNotes: body.notes } : {}),
          ...(typeof body.latestStatusId === "string" ? { leadStatusId: body.latestStatusId } : {}),
          updatedAt: new Date().toISOString(),
        };
        await prisma.appConversation.update({
          where: { id: conv.id },
          data: {
            ...(typeof body.latestStatusId === "string" ? { leadStatusId: body.latestStatusId } : {}),
            payload: updatedPayload,
            updatedAt: new Date(),
          },
        });
      }
    } catch (err) {
      console.error("Failed to sync contact note/status to appConversation:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    contact,
    contacts: await listContactsFromFile(audience, tenantId),
    managers: await listManagersFromFile(tenantId),
  });
}
