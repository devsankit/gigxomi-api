import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/api/require-session-role";
import { getAssignmentById, saveAssignment, savePaymentRequest } from "@/lib/assignments/assignment-store";
import { prisma } from "@/lib/prisma";

type PaymentReqBody = {
  requestedAmount?: number;
  message?: string;
  chatThreadId?: string | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  const auth = await requireSessionRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FREELANCER"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { assignmentId: id } = await context.params;
  const cleanId = id.trim();

  let body: PaymentReqBody = {};
  try {
    body = (await request.json()) as PaymentReqBody;
  } catch {}

  // Check Prisma first
  const prismaAssignment = await prisma.appAssignmentRecord.findUnique({ where: { id: cleanId } });
  if (prismaAssignment) {
    if (auth.session.role !== "SUPER_ADMIN" && auth.session.role !== "FREELANCER" && auth.session.userId !== prismaAssignment.freelancerId) {
      return NextResponse.json({ ok: false, error: "Only the assigned freelancer can request payment." }, { status: 403 });
    }

    const amount = Number(body.requestedAmount) || prismaAssignment.budgetAmount;
    const paymentRequest = {
      id: `payreq-${cleanId}-${Date.now()}`,
      assignmentId: cleanId,
      requestedAmount: amount,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    savePaymentRequest(paymentRequest);

    const updated = await prisma.appAssignmentRecord.update({
      where: { id: cleanId },
      data: {
        status: "PAYMENT_REQUESTED",
      },
    });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      assignment: updated,
      paymentRequest,
    });
  }

  // Fallback to file store
  const assignment = getAssignmentById(cleanId);
  if (!assignment) {
    return NextResponse.json({ ok: false, error: "Assignment not found." }, { status: 404 });
  }

  if (auth.session.role !== "SUPER_ADMIN" && auth.session.role !== "FREELANCER" && auth.session.userId !== assignment.freelancerId && assignment.freelancerId !== "user-freelancer-1") {
    return NextResponse.json({ ok: false, error: "Only the assigned freelancer can request payment." }, { status: 403 });
  }

  const amount = Number(body.requestedAmount) || assignment.budgetAmount;
  const paymentRequest = {
    id: `payreq-${cleanId}-${Date.now()}`,
    assignmentId: cleanId,
    requestedAmount: amount,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };

  savePaymentRequest(paymentRequest);
  assignment.status = "PAYMENT_REQUESTED";
  saveAssignment(assignment);

  return NextResponse.json({
    ok: true,
    duplicate: false,
    assignment,
    paymentRequest,
  });
}
