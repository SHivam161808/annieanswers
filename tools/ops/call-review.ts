/**
 * Daily call review, latency baseline and team alerts (T-1001, T-403, T-1004, T-1005).
 *   npx tsx tools/ops/call-review.ts [--hours 24] [--alert] [--export]
 * Writes build/reports/call-review-<date>.{md,json} (ids, codes, timings only).
 * --alert   posts alerts to TEAM_ALERT_WEBHOOK_URL (Slack/Teams incoming webhook) if any fire.
 * --export  also writes full transcripts to build/exports/ (contains caller data: local only,
 *           git-ignored; delete after analysis per the retention policy).
 * Exit code 2 when alerts fired, so a scheduler can notice.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import {
  alertPayload,
  buildReport,
  renderReport,
  reviewCall,
  type GhlCallLog,
} from '../../src/monitoring/call-review.js';
import { buildCustomValues } from '../../src/prompt/custom-values.js';
import { renderPrompt } from '../../src/prompt/render.js';
import { loadPromptSources } from '../../src/prompt/sources.js';
import { clientForLocation, locationId } from '../env.js';
import { ghl, loadState } from '../ghl/client.js';

const arg = (name: string) => process.argv.includes(`--${name}`);
const hoursIdx = process.argv.indexOf('--hours');
const hours = hoursIdx > 0 ? Number(process.argv[hoursIdx + 1]) : 24;
if (!Number.isFinite(hours) || hours <= 0) throw new Error('--hours must be a positive number');

const to = Date.now();
const from = to - hours * 3600_000;
const { config } = await clientForLocation();
const sources = await loadPromptSources(config.trade_module);
const ctx = {
  config,
  safetyScripts: sources.safetyScripts,
  emergencyNumbers: sources.emergencyNumbers,
  greeting: renderPrompt(sources, 'rendered', buildCustomValues(config)).greeting,
};
// Field id from local provisioning state, else looked up by name (scheduled runs have no state).
const state = await loadState().catch(() => null);
const outcomeFieldId =
  state?.contactFieldIds?.ai_call_outcome ??
  (
    await ghl<{ customFields: { id: string; name: string }[] }>(
      'GET',
      `/locations/${locationId}/customFields?model=contact`,
      '2021-07-28',
    )
  ).customFields.find((f) => f.name === 'ai_call_outcome')?.id;

// Page through call logs (max 50 per page).
const logs: GhlCallLog[] = [];
for (let page = 1; page <= 200; page++) {
  const res = await ghl<{ callLogs?: GhlCallLog[]; total?: number }>(
    'GET',
    `/voice-ai/dashboard/call-logs?locationId=${locationId}&startDate=${from}&endDate=${to}&page=${page}&pageSize=50`,
    'v3',
  );
  logs.push(...(res.callLogs ?? []));
  if (!res.callLogs?.length || logs.length >= (res.total ?? 0)) break;
}

// Outcome per call: the call's own extracted data first, else the contact's field (latest call).
async function outcomeFor(
  log: GhlCallLog & { extractedData?: Record<string, unknown> },
): Promise<string | null> {
  const extracted =
    log.extractedData?.ai_call_outcome ?? log.extractedData?.['contact.ai_call_outcome'];
  if (typeof extracted === 'string') return extracted.trim();
  if (!log.contactId || !outcomeFieldId) return null;
  const contact = await ghl<{ contact: { customFields?: { id: string; value?: unknown }[] } }>(
    'GET',
    `/contacts/${log.contactId}`,
    '2021-07-28',
  ).catch(() => null);
  const value = contact?.contact.customFields?.find((f) => f.id === outcomeFieldId)?.value;
  return typeof value === 'string' ? value.trim() : null;
}

// Bounded concurrency so a big day doesn't hit GHL's rate limit.
const reviewed = [];
for (let i = 0; i < logs.length; i += 5) {
  const batch = logs.slice(i, i + 5);
  reviewed.push(
    ...(await Promise.all(batch.map(async (l) => reviewCall(l, await outcomeFor(l), ctx)))),
  );
}

const report = buildReport(reviewed, {
  from: new Date(from).toISOString(),
  to: new Date(to).toISOString(),
});
await mkdir('build/reports', { recursive: true });
const stamp = new Date(to).toISOString().slice(0, 16).replace(':', '');
await writeFile(`build/reports/call-review-${stamp}.md`, renderReport(report));
await writeFile(`build/reports/call-review-${stamp}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(renderReport(report));
console.log(`report: build/reports/call-review-${stamp}.md`);

if (arg('export')) {
  await mkdir('build/exports', { recursive: true });
  const file = `build/exports/transcripts-${stamp}.jsonl`;
  await writeFile(
    file,
    logs
      .map((l) => JSON.stringify({ id: l.id, createdAt: l.createdAt, transcript: l.transcript }))
      .join('\n') + '\n',
  );
  console.log(
    `exported ${logs.length} transcript(s) to ${file} — contains caller data; delete after analysis`,
  );
}

if (report.alerts.length && arg('alert')) {
  const url = process.env.TEAM_ALERT_WEBHOOK_URL;
  if (!url) console.error('alerts fired but TEAM_ALERT_WEBHOOK_URL is not set');
  else {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(alertPayload(report, config.client_id)),
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`team alert posted: HTTP ${res.status}`);
  }
}
process.exit(report.alerts.length ? 2 : 0);
