import "server-only";

import { createAppNotification } from "@/lib/gigxomi/app-notification-service";
import {
  getServiceByIdFromFile,
  listAllServicesFromFile,
  reviewFreelancerServiceFromFile,
} from "@/lib/gigxomi/dummy-platform-file-store";

export type ServiceReviewFilter = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

export async function listServiceReviews(filter: ServiceReviewFilter = "PENDING") {
  const allServices = await listAllServicesFromFile();

  if (filter === "PENDING") {
    return allServices.filter((service) => service.status === "Pending Review");
  }

  if (filter === "APPROVED") {
    return allServices.filter((service) => service.status === "Approved");
  }

  if (filter === "REJECTED") {
    return allServices.filter((service) => service.status === "Rejected");
  }

  return allServices;
}

export async function decideServiceReview(input: {
  serviceId: string;
  action: "approve" | "reject";
  reviewNote?: string;
  reviewerId?: string;
  reviewerName?: string;
}) {
  const service = await getServiceByIdFromFile(input.serviceId);
  if (!service) {
    return { ok: false as const, status: 404, error: "Service was not found." };
  }

  const updated = await reviewFreelancerServiceFromFile(
    input.serviceId,
    input.action,
    input.reviewNote || (input.action === "approve" ? "Service approved for public catalog." : "Service requires revisions.")
  );

  if (!updated) {
    return { ok: false as const, status: 500, error: "Failed to update service review status." };
  }

  if (service.ownerId) {
    await createAppNotification({
      userId: service.ownerId,
      type: input.action === "approve" ? "service_approved" : "service_rejected",
      title: input.action === "approve" ? "Service approved!" : "Service update needed",
      message:
        input.action === "approve"
          ? `Your service "${service.title}" has been approved and is now live on Gigxomi.`
          : `Your service "${service.title}" requires revisions: ${input.reviewNote || "Please update service details."}`,
      entityType: "freelancer_service",
      entityId: service.id,
    });
  }

  return { ok: true as const, service: updated };
}
