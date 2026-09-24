export const EDITOR_CATEGORIES = [
  "Short-form/Reels/Shorts",
  "Long-form YouTube",
  "Podcast/Interview",
  "Ads/UGC/Performance",
  "Wedding/Event",
  "Corporate/Brand",
  "Education/Course/Webinar",
  "Real Estate",
  "Gaming/Streaming",
  "Motion Graphics/VFX",
  "Documentary/Film",
  "Music Video",
] as const;

export type EditorCategory = (typeof EDITOR_CATEGORIES)[number];
export type AssessmentCompetency = "CATEGORY" | "SETUP" | "WORKFLOW" | "COMMUNICATION" | "SECURITY";

export type AssessmentQuestion = {
  id: string;
  category: EditorCategory | "GENERAL";
  competency: AssessmentCompetency;
  prompt: string;
  options: Array<{ id: string; label: string; points: 0 | 1 | 2 }>;
};

type CategoryBlueprint = {
  id: string;
  category: EditorCategory;
  workflow: string;
  quality: string;
  export: string;
  risk: string;
};

const CATEGORY_BLUEPRINTS: CategoryBlueprint[] = [
  { id: "short", category: "Short-form/Reels/Shorts", workflow: "organize selects around hooks, retention beats, captions and safe zones", quality: "watch the edit once muted and once with audio at phone size", export: "vertical H.264 using the client platform's resolution and bitrate requirements", risk: "placing captions under platform controls" },
  { id: "youtube", category: "Long-form YouTube", workflow: "build a story edit first, then tighten pacing with b-roll, pattern breaks and clean audio", quality: "review continuity, loudness, chapters and visual repetition across the full runtime", export: "the agreed YouTube master plus any requested archive master", risk: "over-editing every sentence and exhausting the viewer" },
  { id: "podcast", category: "Podcast/Interview", workflow: "sync and clean all sources before making multicam and content cuts", quality: "check sync drift, speaker framing, room tone and dialogue loudness", export: "a full episode master plus correctly framed clips when requested", risk: "cutting breaths so tightly that conversation sounds unnatural" },
  { id: "ugc", category: "Ads/UGC/Performance", workflow: "separate hook, proof, benefit and CTA variants so performance changes are traceable", quality: "verify claims, captions, brand-safe areas and CTA timing", export: "clearly named platform variants tied to the approved copy", risk: "changing a regulated product claim without approval" },
  { id: "wedding", category: "Wedding/Event", workflow: "back up and organize footage by event, camera and time before building the story", quality: "check names, key moments, skin tone, music transitions and camera continuity", export: "the contracted highlight and ceremony masters with redundant archive copies", risk: "formatting or deleting camera cards before verified backups" },
  { id: "corporate", category: "Corporate/Brand", workflow: "lock the approved script, brand kit and stakeholder hierarchy before detailed finishing", quality: "verify titles, logos, claims, accessibility and brand consistency", export: "review and master files that follow the client's delivery specification", risk: "using an unapproved logo, font or business claim" },
  { id: "education", category: "Education/Course/Webinar", workflow: "structure lessons around learning objectives, remove dead time and preserve explanations", quality: "check slide readability, terminology, chapter order and speech clarity", export: "consistent lesson masters with predictable naming and navigation", risk: "cutting context that changes the meaning of an instruction" },
  { id: "realestate", category: "Real Estate", workflow: "organize the property route, hero features, agent segments and required disclosures", quality: "check verticals, window exposure, address details and realistic color", export: "listing and social versions that match portal specifications", risk: "misrepresenting a room or digitally altering permanent property features" },
  { id: "gaming", category: "Gaming/Streaming", workflow: "sync gameplay, face camera and voice sources before selecting story and reaction beats", quality: "check sync, game/UI visibility, copyrighted audio and loudness peaks", export: "the agreed long-form master and platform-safe highlights", risk: "covering essential HUD information with graphics" },
  { id: "motion", category: "Motion Graphics/VFX", workflow: "confirm references, frame rate, color pipeline and render dependencies before production", quality: "review motion, edges, tracking, typography and alpha behavior frame by frame", export: "the requested codec, alpha format, frame range and project dependencies", risk: "starting final renders before locking technical delivery requirements" },
  { id: "documentary", category: "Documentary/Film", workflow: "log sources, transcripts, releases and story themes before shaping the assembly", quality: "verify factual context, continuity, audio perspective and source attribution", export: "screening and finishing masters with project and source references intact", risk: "removing context in a way that changes a contributor's meaning" },
  { id: "music", category: "Music Video", workflow: "sync every performance take to the approved master track before creative cutting", quality: "check lip sync, beat intention, flash safety, color continuity and artist approvals", export: "the approved master plus clean or platform variants when contracted", risk: "editing to an unofficial mix that later changes" },
];

const optionSet = (best: string, partial: string, weak: string): AssessmentQuestion["options"] => [
  { id: "a", label: weak, points: 0 },
  { id: "b", label: partial, points: 1 },
  { id: "c", label: best, points: 2 },
];

const categoryQuestions = CATEGORY_BLUEPRINTS.flatMap<AssessmentQuestion>((item) => [
  {
    id: `${item.id}-workflow`, category: item.category, competency: "CATEGORY",
    prompt: `You receive an unorganized ${item.category} project. What is the strongest first workflow?`,
    options: optionSet(item.workflow, "Start editing the most interesting clip and organize files later", "Import everything into one bin and begin adding effects"),
  },
  {
    id: `${item.id}-quality`, category: item.category, competency: "CATEGORY",
    prompt: `Before sending a ${item.category} review, which quality-control approach is most reliable?`,
    options: optionSet(item.quality, "Scrub the timeline quickly and check only the opening", "Export immediately if the timeline has no red render bar"),
  },
  {
    id: `${item.id}-export`, category: item.category, competency: "CATEGORY",
    prompt: `Which delivery choice best protects quality for a ${item.category} client?`,
    options: optionSet(item.export, "Use the same preset for every client but rename the file", "Send the smallest file possible so upload is fast"),
  },
  {
    id: `${item.id}-risk`, category: item.category, competency: "CATEGORY",
    prompt: `Which issue is a serious professional risk in ${item.category} work?`,
    options: optionSet(item.risk, "Keeping an organized version history", "Asking the client to confirm a delivery specification"),
  },
]);

const generalQuestions: AssessmentQuestion[] = [
  { id: "setup-device", category: "GENERAL", competency: "SETUP", prompt: "What is your primary editing setup for paid client work?", options: [{ id: "a", label: "Phone or tablet editing app only", points: 0 }, { id: "b", label: "Entry-level laptop/desktop with a professional NLE", points: 1 }, { id: "c", label: "Laptop/desktop workstation with a professional NLE, monitoring and backup storage", points: 2 }] },
  { id: "setup-software", category: "GENERAL", competency: "SETUP", prompt: "Which statement best describes your editing software workflow?", options: optionSet("I use a professional NLE and can manage proxies, relinking, color and audio handoff", "I use a desktop editor confidently but need help with advanced media management", "I mainly use templates in a mobile app") },
  { id: "setup-storage", category: "GENERAL", competency: "SETUP", prompt: "A client sends 300 GB of footage. What do you do before editing?", options: optionSet("Verify two copies, organize the media, check integrity and then create proxies if needed", "Copy it once to my working drive and begin", "Edit directly from the transfer link or camera card") },
  { id: "setup-playback", category: "GENERAL", competency: "SETUP", prompt: "A 4K timeline is dropping frames. What is the professional response?", options: optionSet("Check codec and storage performance, then use proxies or optimized media without lowering final export quality", "Set the final export to 720p", "Keep editing while frames drop and hope the export is correct") },
  { id: "workflow-brief", category: "GENERAL", competency: "WORKFLOW", prompt: "The brief is missing references and delivery specifications. What should happen first?", options: optionSet("Ask focused questions and confirm scope, references, format and deadline in writing", "Choose a style myself and reveal it at final delivery", "Wait until the deadline is close before asking") },
  { id: "workflow-versions", category: "GENERAL", competency: "WORKFLOW", prompt: "How should project versions be managed?", options: optionSet("Use dated/versioned files and preserve approved milestones so changes can be traced", "Overwrite the same project file after every revision", "Create random copies only when the app crashes") },
  { id: "workflow-delay", category: "GENERAL", competency: "WORKFLOW", prompt: "You discover that delivery may be late. What is the best action?", options: optionSet("Notify the agency early with the cause, current status and a realistic recovery plan", "Stay silent until the deadline and then request more time", "Send an unfinished export and call it final") },
  { id: "workflow-qc", category: "GENERAL", competency: "WORKFLOW", prompt: "What is the minimum reliable final quality check?", options: optionSet("Watch the exported file from start to finish and verify format, audio, text and delivery link", "Watch the first and last ten seconds", "Assume the export is correct if it completed") },
  { id: "workflow-revision", category: "GENERAL", competency: "WORKFLOW", prompt: "A revision note is unclear. What should you do?", options: optionSet("Quote the unclear note, explain the ambiguity and confirm the intended result", "Guess and use another revision round if wrong", "Ignore that note") },
  { id: "workflow-capacity", category: "GENERAL", competency: "WORKFLOW", prompt: "You are offered work beyond your available capacity. What is the trusted response?", options: optionSet("Share your real availability and accept only a scope you can deliver reliably", "Accept everything and decide later", "Accept it and subcontract without permission") },
  { id: "communication-update", category: "GENERAL", competency: "COMMUNICATION", prompt: "What makes a useful progress update?", options: optionSet("Completed work, current milestone, blocker if any, and the next committed update time", "Working on it", "No update unless the agency asks repeatedly") },
  { id: "communication-feedback", category: "GENERAL", competency: "COMMUNICATION", prompt: "An agency gives direct negative feedback. What is the most professional reply?", options: optionSet("Acknowledge the specific issue, confirm the correction plan and ask only necessary questions", "Defend every editing choice before reading all notes", "Stop replying until they calm down") },
  { id: "communication-boundary", category: "GENERAL", competency: "COMMUNICATION", prompt: "A client requests work outside the approved brief. What should you do?", options: optionSet("Explain the scope difference and ask the agency to approve timeline or budget changes", "Do it silently and complain later", "Refuse without explaining why") },
  { id: "security-sharing", category: "GENERAL", competency: "SECURITY", prompt: "How should confidential client footage be shared?", options: optionSet("Through approved access-controlled storage with only necessary collaborators", "Through a public link that never expires", "In a public editing group so someone can help") },
  { id: "security-assets", category: "GENERAL", competency: "SECURITY", prompt: "What is required before using music, fonts or stock assets?", options: optionSet("Confirm the license covers the client's intended commercial use and retain proof", "Use any asset if it is downloadable", "Credit the uploader even when the license forbids commercial use") },
  { id: "security-ai", category: "GENERAL", competency: "SECURITY", prompt: "A tool offers AI processing of uploaded client footage. What is the trusted approach?", options: optionSet("Check client permission, tool terms and data retention before uploading confidential media", "Upload first because AI tools are private by default", "Remove the filename and assume consent is unnecessary") },
];

export const FREELANCER_ASSESSMENT_QUESTION_BANK: AssessmentQuestion[] = [...categoryQuestions, ...generalQuestions];

if (FREELANCER_ASSESSMENT_QUESTION_BANK.length < 60 || new Set(FREELANCER_ASSESSMENT_QUESTION_BANK.map((item) => item.id)).size !== FREELANCER_ASSESSMENT_QUESTION_BANK.length) {
  throw new Error("The freelancer assessment bank must contain at least 60 uniquely identified questions.");
}

function seededRank(seed: string, value: string) {
  let hash = 2166136261;
  for (const character of `${seed}:${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function takeStable(input: AssessmentQuestion[], count: number, seed: string) {
  return [...input].sort((left, right) => seededRank(seed, left.id) - seededRank(seed, right.id)).slice(0, count);
}

export function assignAssessmentQuestions(userId: string, category: EditorCategory, version = 1) {
  const seed = `${userId}:v${version}`;
  const byCompetency = (competency: AssessmentCompetency) => generalQuestions.filter((item) => item.competency === competency);
  const assigned = [
    ...takeStable(categoryQuestions.filter((item) => item.category === category), 4, `${seed}:category`),
    ...takeStable(byCompetency("SETUP"), 2, `${seed}:setup`),
    ...takeStable(byCompetency("WORKFLOW"), 2, `${seed}:workflow`),
    ...takeStable(byCompetency("COMMUNICATION"), 1, `${seed}:communication`),
    ...takeStable(byCompetency("SECURITY"), 1, `${seed}:security`),
  ];
  if (assigned.length !== 10) throw new Error("Freelancer assessments must contain exactly ten questions.");
  return assigned;
}

export function getAssessmentQuestion(questionId: string) {
  return FREELANCER_ASSESSMENT_QUESTION_BANK.find((item) => item.id === questionId) ?? null;
}

export function isEditorCategory(value: unknown): value is EditorCategory {
  return EDITOR_CATEGORIES.includes(String(value) as EditorCategory);
}
