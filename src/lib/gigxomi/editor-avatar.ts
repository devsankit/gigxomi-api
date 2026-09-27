/**
 * Deterministic Gender-Differentiated Editor Avatar Generator & Resolver
 * 
 * Provides bespoke, high-resolution handsome/gorgeous character portraits
 * for Male and Female video editors when they don't have uploaded real photos.
 */

export type Gender = "MALE" | "FEMALE";

export const MALE_AVATARS = [
  "https://api.gigxomi.com/avatars/male-1.jpg",
  "https://api.gigxomi.com/avatars/male-2.jpg",
  "https://api.gigxomi.com/avatars/male-3.jpg",
  "https://api.gigxomi.com/avatars/male-4.jpg",
];

export const FEMALE_AVATARS = [
  "https://api.gigxomi.com/avatars/female-1.jpg",
  "https://api.gigxomi.com/avatars/female-2.jpg",
  "https://api.gigxomi.com/avatars/female-3.jpg",
  "https://api.gigxomi.com/avatars/female-4.jpg",
];

// Comprehensive female first-names and handle stems
const FEMALE_NAMES = new Set([
  "himanshi", "shivani", "kajal", "shubhi", "nidhi", "priya", "pooja", "puja", "anjali", "neha", "riya", 
  "divya", "sneha", "simran", "tanya", "deepika", "muskan", "swati", "komal", "preeti", "shreya", 
  "ananya", "sakshi", "aarti", "arti", "khushi", "payal", "megha", "tanvi", "isha", "rashmi", "sonam", 
  "monika", "jyoti", "sonia", "sheetal", "archana", "pratibha", "vandana", "sunita", "rekha", 
  "radha", "geeta", "seema", "pinky", "kavita", "bhavna", "poonam", "chhavi", "kanchan", "ruchi", 
  "dolly", "pallavi", "shilpa", "urvashi", "mansi", "kashish", "prachi", "manasvi", "vanshika", 
  "drishti", "ishika", "anushka", "akshita", "kriti", "kritika", "aditi", "avani", "bhumika",
  "charu", "chetna", "garima", "hema", "ishita", "jhanvi", "juhi", "karishma", "lavanya", "mahima",
  "nandini", "ragini", "ridhima", "saloni", "samiksha", "sanvi", "shristi", "sonali",
  "tanu", "trupti", "vaishnavi", "vidhi", "zoya", "fatima", "ayesha", "sara", "alisha", "aanya",
  "shruti", "sakshi", "alka", "meenakshi", "anita", "manju", "sarita", "pinki", "anamika"
]);

/**
 * Detects whether a given editor name or handle is female or male.
 * Defaults to MALE if no strong female name matches are identified.
 */
export function detectGender(nameOrIdentifier?: string | null): Gender {
  if (!nameOrIdentifier) return "MALE";
  const clean = String(nameOrIdentifier).toLowerCase().replace(/[^a-z]/g, " ");
  const tokens = clean.split(/\s+/).filter(Boolean);
  
  for (const token of tokens) {
    if (FEMALE_NAMES.has(token)) return "FEMALE";
    for (const female of FEMALE_NAMES) {
      if (token.startsWith(female)) return "FEMALE";
      // Handle user handles like designedbyhimanshi or prajapatkajal818
      if (female.length >= 5 && token.includes(female)) return "FEMALE";
    }
  }
  return "MALE";
}

/**
 * Checks if the avatar URL is empty or a generic mystery-man / placeholder avatar.
 */
export function isPlaceholderAvatar(avatarUrl?: string | null): boolean {
  if (!avatarUrl || typeof avatarUrl !== "string") return true;
  const trimmed = avatarUrl.trim();
  if (!trimmed) return true;
  // Detect Gravatar mystery-man default silhouettes (d=mm, d=mp, d=blank)
  if (trimmed.includes("gravatar.com") && (trimmed.includes("d=mm") || trimmed.includes("d=mp") || trimmed.includes("d=blank"))) {
    return true;
  }
  // Detect generic UI initials or placeholder svgs
  if (trimmed.includes("ui-avatars.com") || trimmed.includes("dicebear.com/7.x/initials") || trimmed.includes("default-avatar")) {
    return true;
  }
  return false;
}

function stringToSeedNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Returns a high-res handsome male or gorgeous female character portrait
 * deterministically chosen for the editor based on their name/id.
 */
export function getEditorAvatar(
  existingAvatarUrl: string | null | undefined,
  nameOrIdentifier?: string | null,
  seedKey?: string | null
): string {
  // If user already has a real uploaded custom photo (and not a gravatar d=mm placeholder), keep it!
  if (existingAvatarUrl && !isPlaceholderAvatar(existingAvatarUrl)) {
    return existingAvatarUrl.trim();
  }

  const gender = detectGender(nameOrIdentifier);
  const seedString = (seedKey || nameOrIdentifier || "editor").trim().toLowerCase();
  const seedNum = stringToSeedNumber(seedString);

  if (gender === "FEMALE") {
    return FEMALE_AVATARS[seedNum % FEMALE_AVATARS.length];
  } else {
    return MALE_AVATARS[seedNum % MALE_AVATARS.length];
  }
}
