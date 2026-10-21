/**
 * Verifies the live GHL deployment matches what is in Git. Read-only. Exit code 1 on any failure.
 *   npx tsx tools/demo/verify.ts
 */
import { readFile } from 'node:fs/promises';
import { CONTACT_FIELDS } from '../../config/schema/contact-fields.js';
import { normalisePostcode } from '../../src/domain/postcode.js';
import { isInServiceArea, parseServiceArea } from '../../src/domain/service-area.js';
import { buildCustomValues } from '../../src/prompt/custom-values.js';
import { renderPrompt } from '../../src/prompt/render.js';
import { loadPromptSources } from '../../src/prompt/sources.js';
import { clientForLocation, locationId, stateFile, token } from '../env.js';

const BASE = 'https://services.leadconnectorhq.com';
const state = JSON.parse(await readFile(stateFile(), 'utf8')) as {
  agentId: string;
  calendarId: string;
  inboundNumber?: string;
};
const publicUrl = (
  process.env.MIDDLEWARE_URL ??
  (await readFile('build/logs/public-url.txt', 'utf8').catch(() => ''))
)
  .trim()
  .replace(/\/$/, '');
if (!publicUrl)
  throw new Error('Set MIDDLEWARE_URL (or build/logs/public-url.txt) to the middleware base URL');

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const get = async <T>(path: string, version: string): Promise<{ status: number; body: T }> => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: version, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
};

const { config } = await clientForLocation();
const sources = await loadPromptSources(config.trade_module);
const expected = renderPrompt(sources, 'rendered', buildCustomValues(config));

const agent = await get<{
  agentPrompt?: string;
  welcomeMessage?: string;
  inboundNumber?: string | null;
  actions?: { id: string; name: string; actionType: string }[];
}>(`/voice-ai/agents/${state.agentId}?locationId=${locationId}`, 'v3');
check('agent reachable', agent.status === 200, `HTTP ${agent.status}`);
check('live prompt matches Git build', agent.body.agentPrompt === expected.prompt);
check('live greeting matches Git build', agent.body.welcomeMessage === expected.greeting);
check(
  'no stopcock/isolation advice in live prompt',
  !/stopcock is|turn the water off at/i.test(agent.body.agentPrompt ?? ''),
);
for (const script of sources.safetyScripts.values()) {
  if (script.status === 'suspended') continue;
  check(
    `safety script ${script.id} live verbatim`,
    (agent.body.agentPrompt ?? '').includes(script.text.trim()),
  );
}
check('UK number attached', Boolean(agent.body.inboundNumber), agent.body.inboundNumber ?? 'none');

const names = new Set((agent.body.actions ?? []).map((a) => a.name));
for (const name of [
  'call_context',
  'check_service_area',
  'escalation',
  'book_appointment',
  'find_booking',
  'available_slots',
  'reschedule_booking',
  'cancel_booking',
  'lookup_fault_code',
]) {
  check(`action ${name} present`, names.has(name));
}
for (const f of CONTACT_FIELDS)
  check(`post-call extraction for ${f.key}`, names.has(`extract_${f.key}`));
const counts = new Map<string, number>();
for (const a of agent.body.actions ?? []) counts.set(a.name, (counts.get(a.name) ?? 0) + 1);
const dupes = [...counts].filter(([, n]) => n > 1).map(([n]) => n);
check('no duplicate actions', dupes.length === 0, dupes.join(', '));

const fields = await get<{ customFields: { name: string }[] }>(
  `/locations/${locationId}/customFields?model=contact`,
  '2021-07-28',
);
const fieldNames = fields.body.customFields?.map((f) => f.name) ?? [];
for (const f of CONTACT_FIELDS)
  check(`contact field ${f.key}`, fieldNames.filter((n) => n === f.key).length === 1);

const cal = await get(`/calendars/${state.calendarId}`, '2021-04-15');
check('demo calendar exists', cal.status === 200, `HTTP ${cal.status}`);

// A postcode guaranteed outside this client's service area (picked from a fixed list).
const outsideCandidates = ['M1 1AE', 'B33 8TH', 'G2 1DY', 'CF10 1EP', 'NE1 4ST', 'EX1 1AA'];
const outside = outsideCandidates.find((pc) => {
  const parsed = normalisePostcode(pc);
  return parsed !== null && !isInServiceArea(parseServiceArea(config.service_area), parsed);
});
if (!outside) throw new Error('could not find an out-of-area test postcode for this client');

const start = performance.now();
const ready = await fetch(`${publicUrl}/readyz`, { signal: AbortSignal.timeout(5000) }).catch(
  () => null,
);
check(
  'middleware reachable via tunnel',
  ready?.status === 200,
  `${Math.round(performance.now() - start)} ms`,
);
const area = await fetch(
  `${publicUrl}/v1/actions/check-service-area?location_id=${locationId}&postcode=${encodeURIComponent(outside)}`,
  {
    headers: { authorization: process.env.WEBHOOK_SECRETS!.split(',')[0]! },
    signal: AbortSignal.timeout(5000),
  },
)
  .then((r) => r.json() as Promise<{ in_service_area?: boolean }>)
  .catch(() => ({}) as { in_service_area?: boolean });
check(`middleware says ${outside} is NOT covered`, area.in_service_area === false);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures ? 1 : 0);
