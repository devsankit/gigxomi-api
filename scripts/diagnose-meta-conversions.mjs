// Read-only readiness checks. Never log access tokens, contact data, or payloads.
// Generic GET permission errors do NOT prove CAPI delivery is denied; use the separate test-event script.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
const snapshot = JSON.parse(await readFile('.gigxomi/local-platform-store.json', 'utf8'));
const states = (snapshot.whatsappStates ?? []).filter((s) => String(s.phoneNumber ?? '').replace(/\D/g, '').endsWith('9993328124'));
console.log(JSON.stringify({ matches: states.length, connections: states.map((s) => ({ tenantId: s.tenantId, phoneNumberId: s.phoneNumberId, wabaId: s.wabaId, pluginEnabled: s.pluginEnabled, status: s.status, suffix: '8124' })) }));
const token = process.env.META_CAPI_ACCESS_TOKEN;
const dataset = process.env.META_CAPI_DATASET_ID;
if (!token || !dataset) { console.log('CAPI not configured'); process.exit(1); }
for (const path of [`${dataset}?fields=id,name`, 'me/permissions']) {
  const response = await fetch(`https://graph.facebook.com/v25.0/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  console.log(JSON.stringify({ check: path.startsWith('me') ? 'permissions' : 'dataset', status: response.status, id: body.id, name: body.name, permissions: body.data, error: body.error && { code: body.error.code, message: body.error.message } }));
}
