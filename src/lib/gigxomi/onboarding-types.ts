export type OnboardingRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "SALES_AGENT" | "FREELANCER";

export type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  route: string;
  ctaLabel: string;
  completionHint?: string;
  manualCompleteAllowed?: boolean;
  tourTarget?: string;
};

export type OnboardingChecklistDefinition = {
  key: string;
  role: OnboardingRole;
  title: string;
  steps: OnboardingStep[];
};

export type OnboardingProgressRecord = {
  id: string;
  userId: string;
  role: OnboardingRole;
  checklistKey: string;
  completedSteps: string[];
  skippedSteps: string[];
  dismissed: boolean;
  completedAt: string | null;
  lastSeenStep: string | null;
  createdAt: string;
  updatedAt: string;
};
