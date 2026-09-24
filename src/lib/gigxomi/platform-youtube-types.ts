export type PublicYouTubeConnectionStatus = "ENV_MISSING" | "DISCONNECTED" | "CONNECTED" | "ERROR";

export type PlatformYouTubeConnectionView = {
  status: PublicYouTubeConnectionStatus;
  envReady: boolean;
  missingEnv: string[];
  channelName: string | null;
  channelId: string | null;
  channelHandle: string | null;
  connectedAt: string | null;
  lastValidatedAt: string | null;
  lastError: string | null;
  scope: string | null;
  canConnect: boolean;
  canPublish: boolean;
};
