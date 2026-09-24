// Compatibility alias. Meta should be configured with /api/meta/whatsapp/webhook,
// but older environments using this path must execute the same verified handler.
export { GET, POST } from "@/app/api/meta/whatsapp/webhook/route";
