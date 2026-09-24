import type { PublicPresetKey } from "@/lib/gigxomi/public-shell-nav";

import { buildSiteUrl, companyKnowledgeBase } from "@/lib/seo/company-knowledge-base";

type KnowledgeBaseSection = {
  body: string[];
  title: string;
};

type KnowledgeBaseFaq = {
  answer: string;
  question: string;
};

export type KnowledgeBaseGuide = {
  callToActionLabel: string;
  callToActionPath: string;
  description: string;
  faq: KnowledgeBaseFaq[];
  intents: string[];
  matcherPreset?: PublicPresetKey;
  slug: string;
  summary: string;
  title: string;
  sections: KnowledgeBaseSection[];
};

export const knowledgeBaseGuides: KnowledgeBaseGuide[] = [
  {
    slug: "video-editor-matcher",
    title: "Video Editor Matcher for Agencies & Creators",
    description:
      "Learn how Gigxomi's prompt matcher helps agencies and creators describe a brief, compare live services, and move toward the right video editing fit faster.",
    summary:
      "Gigxomi's matcher turns a plain-language brief into a shortlist of live editing services, filtered by format, turnaround, budget, and specialization.",
    callToActionLabel: "Use the live matcher",
    callToActionPath: "/",
    intents: ["video editor matcher", "find a video editor", "match my brief to an editor", "video editing shortlist"],
    sections: [
      {
        title: "What the matcher is for",
        body: [
          "The prompt matcher is designed for agencies and creators who already know what they need at a high level, but do not want to review every service manually.",
          "Instead of browsing only by category, users can describe the format, style, speed, or budget they need and Gigxomi narrows the catalog toward the strongest fits.",
        ],
      },
      {
        title: "How the matcher thinks about fit",
        body: [
          "Gigxomi weighs the brief against visible service information such as title, category, summary, turnaround, trust signals, and tags.",
          "This works best when the brief includes a format like reels, UGC, podcasts, YouTube, webinars, or social ads, plus any speed or price constraints.",
        ],
      },
      {
        title: "When to use the matcher instead of simple browsing",
        body: [
          "Use the matcher when the request is specific, such as finding a short-form editor for an urgent campaign, or when you want a shortlist before opening individual service pages.",
          "If the need is broad, such as browsing all services, the public catalog and category pages remain useful entry points as well.",
        ],
      },
    ],
    faq: [
      {
        question: "What kind of briefs work well in the Gigxomi matcher?",
        answer:
          "Briefs work best when they mention the format, target platform, deadline, and budget. Examples include UGC ads, Instagram reels, YouTube edits, or long-form podcast support.",
      },
      {
        question: "Does the matcher replace reading service pages?",
        answer:
          "No. The matcher is a discovery shortcut. It helps narrow the field, but the final decision should still come from reviewing the service page and its sample details.",
      },
      {
        question: "Can agencies use the matcher for overflow work?",
        answer:
          "Yes. Agencies can use it to quickly identify services aligned with rush timelines, campaign formats, or outsourced post-production needs.",
      },
    ],
  },
  {
    slug: "video-editing-services-for-agencies",
    title: "Video Editing Services for Agencies",
    description:
      "Understand how Gigxomi supports agencies with outsourced video editing, overflow capacity, faster turnaround, and flexible post-production support.",
    summary:
      "Gigxomi helps agencies expand editing capacity without building a larger in-house team, especially for repeat client delivery and campaign overflow.",
    callToActionLabel: "Browse agency-fit services",
    callToActionPath: "/?surface=services&preset=premium-editors",
    matcherPreset: "premium-editors",
    intents: [
      "video editing services for agencies",
      "outsourced video editing for agencies",
      "agency video editing partner",
      "white label video editing support",
    ],
    sections: [
      {
        title: "Why agencies use outsourced editing support",
        body: [
          "Agency demand is uneven. Some weeks require extra capacity for launches, retainer delivery, or social content batches, while other weeks do not justify new full-time hires.",
          "Gigxomi is positioned for that gap: it gives agencies a way to scale output without committing to permanent in-house headcount.",
        ],
      },
      {
        title: "What agencies usually need from a partner",
        body: [
          "Most agencies care about dependable turnaround, repeatable quality, clear briefs, and the ability to support different formats without rebuilding the process every time.",
          "That makes categories like short-form, long-form, budget-sensitive, and fast-delivery especially useful when narrowing the right service mix.",
        ],
      },
      {
        title: "What Gigxomi helps agencies avoid",
        body: [
          "A strong outsourced setup reduces the pressure to recruit quickly just to cover temporary spikes in editing demand.",
          "It also gives agencies a clearer way to route overflow work instead of stretching internal teams across too many deadlines at once.",
        ],
      },
    ],
    faq: [
      {
        question: "Is Gigxomi only for large agencies?",
        answer:
          "No. It can also fit small and mid-sized agencies that need overflow editing support, campaign execution help, or specialist formatting without adding staff immediately.",
      },
      {
        question: "What formats matter most for agency buyers?",
        answer:
          "Agencies commonly need short-form social edits, UGC ad variants, long-form YouTube support, webinars, promos, and client-specific post-production packages.",
      },
      {
        question: "Why would an agency use Gigxomi instead of hiring?",
        answer:
          "The main reason is flexibility. Gigxomi is meant to help an agency increase editing capacity when demand rises, without taking on the fixed cost and management overhead of hiring right away.",
      },
    ],
  },
  {
    slug: "video-editing-services-for-creators",
    title: "Video Editing Services for Creators",
    description:
      "See how Gigxomi helps creators stay consistent with short-form, long-form, UGC, and recurring publishing support without building an in-house team.",
    summary:
      "Creators use Gigxomi to keep publishing on schedule, turn raw footage into repeatable content formats, and stay focused on ideation and recording.",
    callToActionLabel: "Browse creator-fit services",
    callToActionPath: "/?surface=services&preset=best-sellers",
    matcherPreset: "best-sellers",
    intents: [
      "video editing services for creators",
      "editor for creators",
      "outsourced editing for YouTubers",
      "editing support for content creators",
    ],
    sections: [
      {
        title: "Where creators usually lose consistency",
        body: [
          "Many creators can record content faster than they can edit, package, repurpose, and publish it.",
          "That bottleneck affects consistency more than ideation does, especially when the same creator is trying to maintain short-form and long-form channels at the same time.",
        ],
      },
      {
        title: "What a creator usually wants from editing support",
        body: [
          "Creators often care about speed, style fit, and repeatability. They want a workflow that can support reels, shorts, YouTube episodes, and UGC-style assets without restarting from zero.",
          "Gigxomi's discovery flow is built around that reality, with clear categories and a matcher that turns plain-language briefs into service recommendations.",
        ],
      },
      {
        title: "How Gigxomi fits creator workflows",
        body: [
          "A creator can start with a live brief, filter by budget or turnaround, and move from broad browsing into a more specific service shortlist.",
          "That reduces the time spent searching and makes the workflow easier to repeat for future publishing cycles.",
        ],
      },
    ],
    faq: [
      {
        question: "Is Gigxomi a fit for creators publishing several formats?",
        answer:
          "Yes. It is especially useful for creators who need help across short-form, long-form, and campaign-oriented edits while keeping one repeatable publishing rhythm.",
      },
      {
        question: "Can creators use Gigxomi for ongoing support instead of one-off edits?",
        answer:
          "Yes. The positioning is not limited to one-off work. It is well suited to creators who need recurring editing capacity as their content output grows.",
      },
      {
        question: "What should a creator include in a brief?",
        answer:
          "A helpful brief mentions the platform, style reference, turnaround expectation, and budget range. The more concrete the brief is, the easier it becomes to narrow the best-fit services.",
      },
    ],
  },
  {
    slug: "short-form-video-editing-services",
    title: "Short-Form Video Editing Services",
    description:
      "Explore how Gigxomi approaches short-form editing for reels, shorts, UGC, hooks, pacing, and fast-turn social publishing support.",
    summary:
      "Short-form editing on Gigxomi is centered on social-first formats like reels, shorts, and ad creatives where pace, clarity, and repeatable output matter.",
    callToActionLabel: "Browse short-form services",
    callToActionPath: "/?surface=services&preset=short-form",
    matcherPreset: "short-form",
    intents: [
      "short form video editing services",
      "reels editor",
      "youtube shorts editor",
      "social media video editor",
    ],
    sections: [
      {
        title: "What makes short-form editing different",
        body: [
          "Short-form content has less time to earn attention, so hook speed, pacing, captions, framing, and early retention matter more than in many long-form edits.",
          "That is why short-form buyers usually search for specialists who already understand reels, shorts, and UGC-style creative patterns.",
        ],
      },
      {
        title: "How Gigxomi organizes short-form discovery",
        body: [
          "Gigxomi has a dedicated short-form discovery preset, plus the live matcher can narrow results further when a buyer adds a style or platform reference.",
          "This makes it easier to separate social-first services from broader editing listings when time is limited.",
        ],
      },
      {
        title: "Who usually needs short-form support",
        body: [
          "Agencies need it for client social delivery, paid media testing, and content batches. Creators need it to maintain consistency and repurpose long-form footage into publishable clips.",
          "In both cases, short-form editing is less about one big asset and more about repeated output with stable quality.",
        ],
      },
    ],
    faq: [
      {
        question: "Does short-form editing usually include UGC-style content?",
        answer:
          "Often, yes. UGC-style edits, reels, shorts, and social ad variants overlap heavily, which is why short-form filtering is a strong starting point for UGC-related briefs too.",
      },
      {
        question: "Why is a short-form page useful for search?",
        answer:
          "It gives search engines and AI systems a stable, text-based page about a specific service intent instead of asking them to infer everything from an interactive interface.",
      },
      {
        question: "What should buyers mention in a short-form brief?",
        answer:
          "The best briefs mention the platform, audience, style reference, desired pace, and whether the edit is organic content, UGC, or paid media creative.",
      },
    ],
  },
  {
    slug: "long-form-video-editing-services",
    title: "Long-Form Video Editing Services",
    description:
      "Learn how Gigxomi supports long-form YouTube, podcast, webinar, and deeper post-production workflows for agencies and creators.",
    summary:
      "Long-form editing on Gigxomi is meant for content that needs stronger structure, watch-time support, and a clearer edit flow across interviews, podcasts, webinars, and YouTube videos.",
    callToActionLabel: "Browse long-form services",
    callToActionPath: "/?surface=services&preset=long-form",
    matcherPreset: "long-form",
    intents: [
      "long form video editing services",
      "youtube editor",
      "podcast video editing",
      "webinar video editing",
    ],
    sections: [
      {
        title: "What long-form buyers care about",
        body: [
          "Long-form projects usually need stronger storytelling, cleaner structure, and more attention to pacing over time than short social edits do.",
          "The brief often includes chapter logic, trimming decisions, narrative flow, or repurposing plans that are not obvious from the raw footage alone.",
        ],
      },
      {
        title: "Why long-form needs its own discovery path",
        body: [
          "Someone looking for a podcast or YouTube editor is usually not looking for the same signals as someone shopping for a short-form reels editor.",
          "Gigxomi separates long-form discovery so the buyer can start with a more relevant subset of the catalog before using budget or quality filters.",
        ],
      },
      {
        title: "Common long-form use cases",
        body: [
          "Long-form needs often include YouTube episodes, podcast video editing, webinar cleanup, interview edits, thought-leadership content, and educational videos.",
          "Those use cases still benefit from short-form repurposing later, but the base edit requires a different structure and decision process.",
        ],
      },
    ],
    faq: [
      {
        question: "Is long-form editing only for YouTube creators?",
        answer:
          "No. Agencies, educators, podcasters, webinar teams, and creators can all need long-form post-production support depending on the content they publish.",
      },
      {
        question: "How should a long-form brief be written?",
        answer:
          "A strong long-form brief explains the goal of the video, the target viewer, the expected final length, and any pacing or narrative constraints that matter.",
      },
      {
        question: "Can long-form work also feed short-form publishing?",
        answer:
          "Yes. Many long-form projects later become the source for clips, reels, and repurposed social edits, which is why a clear long-form workflow can improve the entire content pipeline.",
      },
    ],
  },
  {
    slug: "ugc-video-editing-services",
    title: "UGC Video Editing Services",
    description:
      "Understand how Gigxomi supports UGC-style editing for agencies and creators who need ad-ready, social-first, and creator-style video assets.",
    summary:
      "UGC editing on Gigxomi focuses on creator-style assets that need to feel native to social platforms while still meeting campaign or publishing goals.",
    callToActionLabel: "Explore UGC-ready services",
    callToActionPath: "/?surface=services&preset=short-form",
    matcherPreset: "short-form",
    intents: [
      "ugc video editing services",
      "ugc ad editing",
      "creator style editing",
      "ugc editor for ads",
    ],
    sections: [
      {
        title: "Why UGC editing is usually a separate search intent",
        body: [
          "Buyers looking for UGC editing are often evaluating authenticity, hook style, creator-style pacing, and ad usability, not just general editing capability.",
          "That makes UGC a meaningful intent of its own even though it overlaps with short-form production.",
        ],
      },
      {
        title: "Where Gigxomi fits UGC workflows",
        body: [
          "UGC buyers can start in the short-form preset or use the live matcher with terms like UGC, reels, ad creative, or creator-style content to narrow the right options.",
          "This gives agencies and creators a clearer way to separate native-looking social edits from broader video editing services.",
        ],
      },
      {
        title: "What makes a UGC brief easier to match",
        body: [
          "Helpful briefs mention the platform, ad goal, hook angle, brand tone, and whether the final asset is for paid media, organic posting, or testing variants.",
          "Those details help the discovery flow understand whether the buyer needs an ad-style editor, a social-first editor, or a broader post-production partner.",
        ],
      },
    ],
    faq: [
      {
        question: "Is UGC editing the same as generic short-form editing?",
        answer:
          "Not exactly. UGC often overlaps with short-form work, but the buyer intent is usually more specific: the asset needs to feel platform-native, creator-driven, and often campaign-ready.",
      },
      {
        question: "Who usually searches for UGC video editing services?",
        answer:
          "Performance-focused agencies, DTC brands, creator teams, and businesses testing social-first ad creative are common UGC buyers.",
      },
      {
        question: "Can the Gigxomi matcher help with UGC briefs?",
        answer:
          "Yes. UGC-style terms are already a strong signal in the matcher because they overlap with short-form, reels, and social campaign workflows.",
      },
    ],
  },
];

export function getKnowledgeBaseGuide(slug: string) {
  return knowledgeBaseGuides.find((guide) => guide.slug === slug) ?? null;
}

export function buildKnowledgeBaseGuideUrl(slug: string) {
  return buildSiteUrl(`/knowledge-base/${slug}`);
}

export function buildLlmText() {
  const lines = [
    `# ${companyKnowledgeBase.brandName}`,
    "",
    `> ${companyKnowledgeBase.businessDescription}`,
    "",
    "## Official website",
    companyKnowledgeBase.siteUrl,
    "",
    "## Primary positioning",
    `- ${companyKnowledgeBase.homeTitle}`,
    `- ${companyKnowledgeBase.homeDescription}`,
    "",
    "## Core audiences",
    ...companyKnowledgeBase.audiences.map((audience) => `- ${audience}`),
    "",
    "## Core services",
    ...companyKnowledgeBase.coreServices.map((service) => `- ${service}`),
    "",
    "## Key URLs",
    `- Home: ${companyKnowledgeBase.siteUrl}`,
    `- Pricing: ${buildSiteUrl("/pricing")}`,
    `- Agency Margin Calculator: ${buildSiteUrl("/tools/agency-margin-calculator")}`,
    `- Gigxomi vs Frame.io: ${buildSiteUrl("/vs/frame-io")}`,
    `- Gigxomi vs ClickUp: ${buildSiteUrl("/vs/clickup-for-video-agencies")}`,
    `- Knowledge Base: ${buildSiteUrl("/knowledge-base")}`,
    ...knowledgeBaseGuides.map((guide) => `- ${guide.title}: ${buildKnowledgeBaseGuideUrl(guide.slug)}`),
    "",
    "## Buying context",
    "- Gigxomi is positioned as a video editing agency management platform and studio operations software.",
    "- The core promise is scaling post-production with unlimited editor seats, anti-poaching privacy, and 0% platform commission.",
    "- Flat ₹2,000/month subscription eliminates per-seat SaaS taxes charged by Frame.io ($15/seat) and ClickUp ($10/seat).",
    "- Discovery can begin through direct category browsing or a live prompt matcher on the home page.",
  ];

  return `${lines.join("\n")}\n`;
}
