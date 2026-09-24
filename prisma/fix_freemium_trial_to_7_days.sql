-- Safe SQL migration to normalize all Agency Freemium packages and users to 7-Day Free Trial (Max 2 Editors)
UPDATE "packages"
SET
  "shortSubtitle" = '7-day agency launch trial',
  "description" = 'Try the core agency workspace for 7 days with assignment access for up to two confirmed editors.',
  "badgeText" = '7 days free trial',
  "ctaLabel" = 'Start 7-day Free Trial',
  "trialEnabled" = true,
  "trialDays" = 7,
  "durationDays" = 7,
  "editorFreelancerLimit" = 2,
  "teamMemberLimit" = 2,
  "activeProjectLimit" = 5,
  "billingLabel" = 'Free for 7 days',
  "statusLabel" = '7-Day Free Trial',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'pkg-agency-freemium' OR "slug" = 'agency-freemium';

UPDATE "AppAuthUser"
SET
  "packageExpiresAt" = "createdAt" + INTERVAL '7 days',
  "packageName" = 'Agency Freemium'
WHERE ("packageId" = 'pkg-agency-freemium' OR "packageName" ILIKE '%freemium%')
  AND ("packageExpiresAt" IS NULL OR "packageExpiresAt" > "createdAt" + INTERVAL '8 days');

UPDATE "user_subscriptions"
SET
  "expiresAt" = COALESCE("startsAt", "createdAt") + INTERVAL '7 days',
  "renewsAt" = COALESCE("startsAt", "createdAt") + INTERVAL '7 days',
  "nextBillingDate" = COALESCE("startsAt", "createdAt") + INTERVAL '7 days',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "packageId" IN (SELECT "id" FROM "packages" WHERE "slug" = 'agency-freemium' OR "id" = 'pkg-agency-freemium')
  AND ("expiresAt" IS NULL OR "expiresAt" > COALESCE("startsAt", "createdAt") + INTERVAL '8 days');
