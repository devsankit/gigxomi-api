export type AppRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "SALES_AGENT" | "FREELANCER";
export type PackageAudience = "FREELANCER" | "AGENCY";
export type PackageStatus = "ACTIVE" | "PAUSED" | "EXPIRED" | null;
export type WorkspaceMode = "AGENCY" | "FREELANCER" | null;
export type PublicAuthIntentFlow = "LOGIN" | "SIGNUP";
export type PublicAuthIntentStatus = "PENDING_WHATSAPP" | "OTP_ISSUED" | "PENDING_SUBSCRIPTION" | "VERIFIED" | "EXPIRED" | "SUPERSEDED";
export type AuthOtpDeliveryMode = "whatsapp-sent" | "local-only" | "preconfigured-code";

export type SessionUser = {
  userId: string;
  role: AppRole;
  assignedRole: AppRole;
  tenantId: string | null;
  displayName: string;
  email: string | null;
  phone: string;
  packageId: string | null;
  packageName: string | null;
  packageAudience: PackageAudience | null;
  packageStatus: PackageStatus;
  packageExpiresAt: string | null;
  workspaceMode: WorkspaceMode;
  sessionId: string;
  expiresAt: number;
};

export type DemoCredential = {
  role: AppRole;
  displayName: string;
  email: string;
  phone: string;
  phoneAliases?: string[];
  password: string;
  otpCode: string;
  tenantId?: string | null;
};

export type ManagedAuthUser = {
  id: string;
  role: AppRole;
  assignedRole: AppRole;
  tenantId: string | null;
  displayName: string;
  email: string;
  phone: string;
  packageId: string | null;
  packageName: string | null;
  packageAudience: PackageAudience | null;
  packageStatus: PackageStatus;
  packageExpiresAt: string | null;
  workspaceMode: WorkspaceMode;
  isSeeded: boolean;
  createdAt: string | null;
  createdByUserId: string | null;
  lastLoginAt?: string;
  lastOtpSentAt?: string;
};

export type CreateInternalUserInput = {
  role: AppRole;
  displayName: string;
  email: string;
  phone: string;
  password: string;
  packageId?: string | null;
  packageStatus?: Exclude<PackageStatus, null>;
  packageExpiresAt?: string | null;
  tenantId?: string | null;
  createdByUserId?: string | null;
};

export type PublicAuthIntentRecord = {
  id: string;
  flow: PublicAuthIntentFlow;
  status: PublicAuthIntentStatus;
  phone: string;
  displayName: string | null;
  email: string | null;
  packageId: string | null;
  salesReferralCode: string | null;
  redirectTo: string | null;
  userId: string | null;
  challengeId: string | null;
  challengeIssuedAt: string | null;
  whatsappVerifiedAt?: string | null;
  completedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};
