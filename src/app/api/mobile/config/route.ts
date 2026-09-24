import { NextResponse } from "next/server";

import { gigxomiThemeTokens } from "@/lib/gigxomi/theme-tokens";

const MOBILE_CONFIG = {
  schemaVersion: 1,
  theme: {
    bg: gigxomiThemeTokens.canvas,
    bgSoft: gigxomiThemeTokens.surfaceSoft,
    surface: gigxomiThemeTokens.surface,
    surfaceElevated: gigxomiThemeTokens.surfaceElevated,
    textPrimary: gigxomiThemeTokens.textPrimary,
    textSecondary: gigxomiThemeTokens.textSecondary,
    textMuted: gigxomiThemeTokens.textMuted,
    primary: gigxomiThemeTokens.primary,
    primaryStrong: gigxomiThemeTokens.primaryHover,
    primarySoft: gigxomiThemeTokens.active,
    primaryBorder: gigxomiThemeTokens.primaryBorder,
    success: "#A3FF3F",
    warning: "#FFC857",
    error: "#FF5A7A",
    glass: gigxomiThemeTokens.glass,
  },
  features: {
    newBottomNav: true,
    telegramInspiredChat: true,
    showOnboarding: true,
    realtimeWorkMatching: true,
  },
  navigation: {
    freelancer: ["dashboard", "chat", "applyWork", "team", "settings"],
    agency: ["dashboard", "chat", "work", "team", "settings"],
    manager: ["dashboard", "chat", "tasks", "settings"],
    superAdmin: ["overview", "chat", "team", "settings"],
  },
  copy: {
    onboardingTitle: "Complete your setup",
  },
};

export function GET() {
  return NextResponse.json(MOBILE_CONFIG);
}
