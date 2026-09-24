# Persistent WhatsApp conversation memory

This is an application-specific LCM-style implementation, not a claim of perfect recall or the upstream LCM runtime. Original messages are retained, linked summary nodes form a hierarchy, and retrieval recovers source text. PostgreSQL tables are additive and independent of existing conversation storage.

## Configuration and rollout

- `AI_MEMORY_MODE=off` is default. `shadow` prepares memory and logs metrics but the existing reply context remains active. `live` enables memory only for IDs explicitly listed in `AI_MEMORY_LIVE_CONVERSATIONS` (comma separated). There is no implicit all-customers switch.
- Roll back by setting `AI_MEMORY_MODE=off` and restarting only the API process with refreshed environment. This does not delete history or change training rules.
- Apply only `prisma/migrations/20260924130000_ai_conversation_memory/migration.sql` in a transaction after reviewing pending migration state. Do not run a blanket schema push.
- Scope is a hash of namespace, tenant ID, receiving WhatsApp phone-number ID, and conversation ID. Test namespace is always distinct.
- The 6,000 memory token budget uses a conservative UTF-8-byte upper bound, not a tokenizer-specific exact count. Existing system/training prompt and output tokens are additional. Oversized originals are retained but may require clarification. Summary batches are capped at 24KB; failures degrade safely.
- Two older 12-message batches maximum are summarized per interaction; import progresses lazily. Nodes compact six at a time. Retrieval uses lexical original search plus at most two model-guided node-selection calls. A new provider request is not made to re-summarize a cached batch.
- Unknown or unavailable evidence blocks sensitive actions. CRM registration, opt-out and human handover remain authoritative and are never inferred from memory summaries. All memory text is untrusted evidence, not system instructions.
- Retention follows the application's customer-data retention policy. Before enabling customer data deletion, delete memory rows for the corresponding calculated scope from all three memory tables as well; archive retention is not a permission to retain deleted customer data indefinitely.

## Isolated test API

Use the existing bearer-authenticated `POST /api/sales/ai-training` endpoint:

```json
{
  "action": "memory-test",
  "sessionId": "qa-solo-team-1",
  "turnId": "turn-1",
  "agencyRegistered": false,
  "messages": [{"role":"user","content":"Hi, I work solo with three clients."}]
}
```

Omit sessionId to create a session. Reuse it to continue; supply only new turns. Reuse turnId for retries. Up to 500 messages per request, 20,000 characters per message. State is persisted in test-only memory; this endpoint never sends WhatsApp messages, books training or updates lead/CAPI records. Response includes reply, source IDs, memory version, conservative context-token bound, memory call counts and latency. `proposedAction` is diagnostic only.

Run `node --test scripts/tests/conversation-memory.test.cjs`. Compare model responses on identical anonymised transcripts via old `action:test` and new `action:memory-test`. The old endpoint has a 40-message limit, which should be recorded in comparisons. Check provider fallback using mocked requests before rollout; do not exhaust live credentials to test fallback.

## Observability

Memory logs contain hashed scope/version and source IDs, not customer text. `ai-usage` records label provider-reported memory usage as `memory-summary` or `memory-retrieval`; usage snapshots expose separate totals. A degraded memory flag, context size, retrieval IDs and duration support rollout decisions.

## Build prerequisite recovered

The API repository imports `docs/whatsapp/gigxomi-project-brief-flow.json` but omitted it during the service split. The asset included here is copied unchanged from the existing server app asset; no WhatsApp flow behaviour is modified.
