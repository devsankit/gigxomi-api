import "server-only";

import { prisma } from "@/lib/prisma";

export type InHouseEditorSettings = {
  exclusiveAgencyOnly: boolean;      // True: locked to this agency, cannot be hired/invited by others
  marketplaceVisible: boolean;       // False: hidden from marketplace & discovery by other agencies
  canCreateGigs: boolean;            // False: blocked from publishing/creating public gigs/services
  canSendCustomerMessage: boolean;   // False: read-only in customer chat lanes
  directClientDelivery: boolean;     // False: deliveries require agency manager review
};

export const DEFAULT_INHOUSE_SETTINGS: InHouseEditorSettings = {
  exclusiveAgencyOnly: true,
  marketplaceVisible: false,
  canCreateGigs: false,
  canSendCustomerMessage: false,
  directClientDelivery: false,
};

export const DEFAULT_INDEPENDENT_SETTINGS: InHouseEditorSettings = {
  exclusiveAgencyOnly: false,
  marketplaceVisible: true,
  canCreateGigs: true,
  canSendCustomerMessage: false,
  directClientDelivery: false,
};

const PREFIX = "inhouse:";
const PERM_EXCLUSIVE = `${PREFIX}exclusive`;
const PERM_HIDE_MARKETPLACE = `${PREFIX}hide_marketplace`;
const PERM_MARKETPLACE_VISIBLE = `${PREFIX}marketplace_visible`;
const PERM_BLOCK_GIGS = `${PREFIX}block_gigs`;
const PERM_ALLOW_GIGS = `${PREFIX}allow_gigs`;
const PERM_CLIENT_CHAT = `${PREFIX}client_chat`;
const PERM_DIRECT_DELIVERY = `${PREFIX}direct_delivery`;

export function parseInHouseSettings(
  permissions: string[] = [],
  metadata?: unknown
): InHouseEditorSettings {
  const metaObj = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
  const metaSettings = metaObj.inHouseSettings && typeof metaObj.inHouseSettings === "object"
    ? (metaObj.inHouseSettings as Record<string, unknown>)
    : null;

  if (metaSettings) {
    return {
      exclusiveAgencyOnly: Boolean(metaSettings.exclusiveAgencyOnly ?? DEFAULT_INHOUSE_SETTINGS.exclusiveAgencyOnly),
      marketplaceVisible: Boolean(metaSettings.marketplaceVisible ?? DEFAULT_INHOUSE_SETTINGS.marketplaceVisible),
      canCreateGigs: Boolean(metaSettings.canCreateGigs ?? DEFAULT_INHOUSE_SETTINGS.canCreateGigs),
      canSendCustomerMessage: Boolean(metaSettings.canSendCustomerMessage ?? DEFAULT_INHOUSE_SETTINGS.canSendCustomerMessage),
      directClientDelivery: Boolean(metaSettings.directClientDelivery ?? DEFAULT_INHOUSE_SETTINGS.directClientDelivery),
    };
  }

  // Parse from permissions array
  const hasExclusive = permissions.includes(PERM_EXCLUSIVE);
  const hasHideMarketplace = permissions.includes(PERM_HIDE_MARKETPLACE);
  const hasMarketplaceVisible = permissions.includes(PERM_MARKETPLACE_VISIBLE);
  const hasBlockGigs = permissions.includes(PERM_BLOCK_GIGS);
  const hasAllowGigs = permissions.includes(PERM_ALLOW_GIGS);
  const hasClientChat = permissions.includes(PERM_CLIENT_CHAT) || permissions.includes("chat");
  const hasDirectDelivery = permissions.includes(PERM_DIRECT_DELIVERY);

  // If inhouse markers exist, deduce state
  if (hasExclusive || hasHideMarketplace || hasBlockGigs || hasMarketplaceVisible || hasAllowGigs) {
    return {
      exclusiveAgencyOnly: hasExclusive,
      marketplaceVisible: hasMarketplaceVisible && !hasHideMarketplace,
      canCreateGigs: hasAllowGigs && !hasBlockGigs,
      canSendCustomerMessage: hasClientChat,
      directClientDelivery: hasDirectDelivery,
    };
  }

  // Default to standard independent member if no markers set
  return {
    ...DEFAULT_INDEPENDENT_SETTINGS,
    canSendCustomerMessage: hasClientChat,
  };
}

export function encodeInHousePermissions(settings: Partial<InHouseEditorSettings>): string[] {
  const perms: string[] = [];

  if (settings.exclusiveAgencyOnly) {
    perms.push(PERM_EXCLUSIVE);
  }

  if (settings.marketplaceVisible) {
    perms.push(PERM_MARKETPLACE_VISIBLE);
  } else {
    perms.push(PERM_HIDE_MARKETPLACE);
  }

  if (settings.canCreateGigs) {
    perms.push(PERM_ALLOW_GIGS);
  } else {
    perms.push(PERM_BLOCK_GIGS);
  }

  if (settings.canSendCustomerMessage) {
    perms.push(PERM_CLIENT_CHAT);
  }

  if (settings.directClientDelivery) {
    perms.push(PERM_DIRECT_DELIVERY);
  }

  return perms;
}

export async function checkFreelancerInHouseRestrictions(freelancerId: string): Promise<{
  isInHouse: boolean;
  owningTenantId: string | null;
  owningAgencyName: string | null;
  settings: InHouseEditorSettings;
  canCreateGigs: boolean;
  isExclusive: boolean;
  isMarketplaceVisible: boolean;
}> {
  const activeMemberships = await prisma.appTeamMembership.findMany({
    where: {
      freelancerId,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!activeMemberships.length) {
    return {
      isInHouse: false,
      owningTenantId: null,
      owningAgencyName: null,
      settings: DEFAULT_INDEPENDENT_SETTINGS,
      canCreateGigs: true,
      isExclusive: false,
      isMarketplaceVisible: true,
    };
  }

  // Find if any active membership has exclusive or restricted in-house settings
  for (const membership of activeMemberships) {
    const parsed = parseInHouseSettings(membership.permissions, membership.metadata);
    if (parsed.exclusiveAgencyOnly || !parsed.canCreateGigs || !parsed.marketplaceVisible) {
      return {
        isInHouse: true,
        owningTenantId: membership.tenantId,
        owningAgencyName: membership.agencyName,
        settings: parsed,
        canCreateGigs: parsed.canCreateGigs,
        isExclusive: parsed.exclusiveAgencyOnly,
        isMarketplaceVisible: parsed.marketplaceVisible,
      };
    }
  }

  // If no restrictive membership, check primary active membership
  const primary = activeMemberships[0];
  const settings = parseInHouseSettings(primary.permissions, primary.metadata);
  return {
    isInHouse: false,
    owningTenantId: primary.tenantId,
    owningAgencyName: primary.agencyName,
    settings,
    canCreateGigs: settings.canCreateGigs,
    isExclusive: settings.exclusiveAgencyOnly,
    isMarketplaceVisible: settings.marketplaceVisible,
  };
}

export async function isEditorRestrictedForExternalAgency(
  freelancerId: string,
  askingTenantId: string
): Promise<{
  restricted: boolean;
  reason?: string;
  owningAgencyName?: string;
}> {
  const restrictions = await checkFreelancerInHouseRestrictions(freelancerId);
  if (!restrictions.isInHouse) {
    return { restricted: false };
  }

  if (restrictions.owningTenantId && restrictions.owningTenantId === askingTenantId) {
    // The agency asking is the owner agency, so they have full access
    return { restricted: false };
  }

  if (restrictions.isExclusive) {
    return {
      restricted: true,
      reason: `This editor is exclusively contracted with ${restrictions.owningAgencyName || "an agency"} and cannot be invited or assigned by other agencies.`,
      owningAgencyName: restrictions.owningAgencyName || "Agency",
    };
  }

  if (!restrictions.isMarketplaceVisible) {
    return {
      restricted: true,
      reason: "This editor is an in-house team member and is not available in the public directory.",
      owningAgencyName: restrictions.owningAgencyName || "Agency",
    };
  }

  return { restricted: false };
}
