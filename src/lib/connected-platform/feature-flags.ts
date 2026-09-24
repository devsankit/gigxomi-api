export function isConnectedPlatformV2Enabled() {
  return process.env.CONNECTED_PLATFORM_V2_ENABLED !== "false";
}
export function assertConnectedPlatformV2Enabled() {
  if (!isConnectedPlatformV2Enabled()) {
    throw new Error("Connected Platform v2 is not enabled for this environment.");
  }
}
