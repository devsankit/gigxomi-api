export type EditorTrustSignalState = "collecting" | "ready" | "watch";

export type EditorTrustSignal = {
  label: string;
  valueLabel: string;
  percentage: number | null;
  state: EditorTrustSignalState;
  note: string;
};

export type EditorTrustSignalSummary = {
  trustScore: EditorTrustSignal;
  responseTime: EditorTrustSignal;
};

export type EditorTrustCollectorMetrics = {
  completedPaidProjects?: number;
  reviewCount?: number;
  averageReviewRating?: number;
  onTimeDeliveryRate?: number;
  revisionEfficiencyRate?: number;
  managerComplianceRate?: number;
  disputeCount?: number;
  firstResponseSamples?: number;
  averageFirstResponseMinutes?: number;
};

export const EDITOR_TRUST_SCORE_RULES = [
  {
    label: "Client rating",
    weight: 30,
    source: "Post-completion 1-5 star customer review after payment and delivery confirmation.",
  },
  {
    label: "On-time delivery",
    weight: 25,
    source: "Project due date versus final approved delivery timestamp.",
  },
  {
    label: "Response speed",
    weight: 20,
    source: "Chat collector bot measures first editor response after customer or manager message.",
  },
  {
    label: "Revision efficiency",
    weight: 15,
    source: "Approved delivery count versus revision and rework count.",
  },
  {
    label: "Manager compliance",
    weight: 10,
    source: "Manager review actions, missed instructions, and escalation flags.",
  },
] as const;

const MIN_PROJECTS_FOR_PUBLIC_TRUST_SCORE = 3;
const MIN_REVIEWS_FOR_PUBLIC_TRUST_SCORE = 3;
const MIN_RESPONSE_SAMPLES_FOR_PUBLIC_RESPONSE_TIME = 5;

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeRate(value: number | undefined, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return value <= 1 ? value * 100 : value;
}

function scoreAverageResponseTime(minutes: number | undefined) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return null;
  }

  if (minutes <= 5) return 100;
  if (minutes <= 15) return 92;
  if (minutes <= 30) return 82;
  if (minutes <= 60) return 68;
  if (minutes <= 180) return 45;
  return 25;
}

function formatResponseTime(minutes: number | undefined) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return "Measuring";
  }

  if (minutes < 60) {
    return `${Math.round(minutes)} min avg`;
  }

  return `${Math.round(minutes / 60)} hr avg`;
}

export function calculateEditorTrustSignal(metrics: EditorTrustCollectorMetrics = {}): EditorTrustSignal {
  const completedPaidProjects = Math.max(0, Math.floor(metrics.completedPaidProjects ?? 0));
  const reviewCount = Math.max(0, Math.floor(metrics.reviewCount ?? 0));

  if (completedPaidProjects < MIN_PROJECTS_FOR_PUBLIC_TRUST_SCORE || reviewCount < MIN_REVIEWS_FOR_PUBLIC_TRUST_SCORE) {
    return {
      label: "Trust score",
      valueLabel: "Collecting",
      percentage: null,
      state: "collecting",
      note: "Unlocks after 3 paid deliveries and 3 verified customer reviews.",
    };
  }

  const reviewScore = clampPercent(((metrics.averageReviewRating ?? 0) / 5) * 100);
  const responseScore = scoreAverageResponseTime(metrics.averageFirstResponseMinutes) ?? 0;
  const onTimeScore = clampPercent(normalizeRate(metrics.onTimeDeliveryRate));
  const revisionScore = clampPercent(normalizeRate(metrics.revisionEfficiencyRate));
  const complianceScore = clampPercent(normalizeRate(metrics.managerComplianceRate, 85));
  const disputePenalty = Math.min(20, Math.max(0, Math.floor(metrics.disputeCount ?? 0)) * 5);
  const weightedScore =
    reviewScore * 0.3 +
    onTimeScore * 0.25 +
    responseScore * 0.2 +
    revisionScore * 0.15 +
    complianceScore * 0.1 -
    disputePenalty;
  const percentage = clampPercent(weightedScore);

  return {
    label: "Trust score",
    valueLabel: `${percentage}/100`,
    percentage,
    state: percentage >= 70 ? "ready" : "watch",
    note: "Calculated from verified ratings, delivery, response, revision, and manager signals.",
  };
}

export function calculateEditorResponseTimeSignal(metrics: EditorTrustCollectorMetrics = {}): EditorTrustSignal {
  const samples = Math.max(0, Math.floor(metrics.firstResponseSamples ?? 0));
  const responseScore = scoreAverageResponseTime(metrics.averageFirstResponseMinutes);

  if (samples < MIN_RESPONSE_SAMPLES_FOR_PUBLIC_RESPONSE_TIME || responseScore === null) {
    return {
      label: "Response time",
      valueLabel: "Measuring",
      percentage: null,
      state: "collecting",
      note: "Chat collector needs 5 first-response samples before showing a public response bar.",
    };
  }

  return {
    label: "Response time",
    valueLabel: formatResponseTime(metrics.averageFirstResponseMinutes),
    percentage: clampPercent(responseScore),
    state: responseScore >= 70 ? "ready" : "watch",
    note: "Based on average first response after customer or manager messages.",
  };
}

export function buildEditorTrustSignalSummary(metrics: EditorTrustCollectorMetrics = {}): EditorTrustSignalSummary {
  return {
    trustScore: calculateEditorTrustSignal(metrics),
    responseTime: calculateEditorResponseTimeSignal(metrics),
  };
}
