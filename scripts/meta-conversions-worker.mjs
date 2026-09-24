// Independent delivery process; never handles production WhatsApp/Instagram ingress.
import 'dotenv/config';
const secret = process.env.CRON_SECRET?.trim();
if (!secret) throw new Error('CRON_SECRET is required for the conversion worker');
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
while (!stopped) {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/cron/meta-conversions', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(200000),
    });
    const body = await response.json().catch(() => ({}));
    console.log(JSON.stringify({ status: response.status, delivery: body.delivery, attribution: body.attribution }));
  } catch { console.error('Meta conversion worker request failed; retrying next cycle'); }
  await new Promise((resolve) => setTimeout(resolve, 15000));
}
