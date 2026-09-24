import { companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";

type InquiryService = {
  title: string;
  slug: string;
  basePrice?: number;
  deliveryTime?: string;
  ownerName?: string;
  publicHref?: string | null;
};

type AgencyInquiry = {
  agencyName: string;
  agencySlug: string;
  whatsappNumber?: string | null;
};

function getDigits(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function getPublicInquiryNumber() {
  const configured = getDigits(process.env.NEXT_PUBLIC_GIGXOMI_WHATSAPP_NUMBER ?? "");
  return configured || "919993328124";
}

export function buildServiceInquiryHref(service: InquiryService) {
  const servicePath = service.publicHref?.trim() || `/services/${service.slug}`;
  const lines = [
    "Hi Gigxomi,",
    `I want to discuss this service: ${service.title}`,
    service.ownerName ? `Editor: ${service.ownerName}` : "",
    `Service page: ${servicePath}`,
    service.basePrice ? `Starting price: INR ${service.basePrice.toLocaleString("en-IN")}` : "",
    service.deliveryTime ? `Expected delivery: ${service.deliveryTime}` : "",
    "Please guide me on the next steps.",
  ].filter(Boolean);

  return `https://wa.me/${getPublicInquiryNumber()}?text=${encodeURIComponent(lines.join("\n"))}`;
}

export function buildAgencyInquiryHref(agency: AgencyInquiry) {
  const targetNumber = getDigits(agency.whatsappNumber ?? "") || getPublicInquiryNumber();
  const lines = [
    `Hi ${agency.agencyName},`,
    "I found your agency profile on Gigxomi and want to discuss a project.",
    `Agency page: /agency/${agency.agencySlug}`,
    "Please share the next steps.",
  ];

  return `https://wa.me/${targetNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
}
