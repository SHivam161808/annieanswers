/**
 * Phase 0 spike — READ-ONLY probe of a GHL sub-account.
 *   npx tsx tools/spike/probe.ts
 * Reads GHL_PRIVATE_TOKEN and GHL_LOCATION_ID from .env. Sends GET requests only.
 * Records status, latency and response *shape* (keys, types, counts) — never contact data or
 * transcript text — to build/spike/probe-report.json and stdout.
 */
import { mkdir, writeFile } from 'node:fs/promises';

const BASE_URL = 'https://services.leadconnectorhq.com';
const TIMEOUT_MS = 10_000;

process.loadEnvFile('.env');
const token = process.env.GHL_PRIVATE_TOKEN;
const locationId = process.env.GHL_LOCATION_ID;
if (!token || !locationId) {
  console.error('GHL_PRIVATE_TOKEN and GHL_LOCATION_ID must be set in .env');
  process.exit(2);
}

interface ProbeResult {
  name: string;
  path: string;
  status: number | 'error';
  latency_ms: number;
  shape?: unknown;
  error?: string;
}

/** Structure only: keys and value types, arrays summarised by length and first element's shape. */
function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 5) return '…';
  if (Array.isArray(value)) {
    return value.length ? { array: value.length, of: shapeOf(value[0], depth + 1) } : { array: 0 };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v, depth + 1)]));
  }
  return value === null ? 'null' : typeof value;
}

async function get(
  name: string,
  path: string,
  version: string,
): Promise<{ result: ProbeResult; body: unknown }> {
  const start = performance.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Version: version, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latency = Math.round(performance.now() - start);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { non_json_length: text.length };
    }
    const result: ProbeResult = { name, path, status: res.status, latency_ms: latency };
    if (res.ok) result.shape = shapeOf(body);
    else
      result.error =
        typeof (body as { message?: unknown })?.message === 'string'
          ? (body as { message: string }).message.slice(0, 200)
          : `HTTP ${res.status}`;
    return { result, body: res.ok ? body : null };
  } catch (err) {
    return {
      result: {
        name,
        path,
        status: 'error',
        latency_ms: Math.round(performance.now() - start),
        error: (err as Error).name,
      },
      body: null,
    };
  }
}

const loc = encodeURIComponent(locationId);
const results: ProbeResult[] = [];
const findings: Record<string, unknown> = {};

async function run(name: string, path: string, version: string) {
  const r = await get(name, path, version);
  results.push(r.result);
  const flag = r.result.status === 200 ? 'ok  ' : 'FAIL';
  console.log(
    `${flag} ${String(r.result.status).padEnd(5)} ${String(r.result.latency_ms).padStart(5)}ms  ${name}${r.result.error ? `  — ${r.result.error}` : ''}`,
  );
  return r.body;
}

await run('location', `/locations/${loc}`, '2021-07-28');
const agents = (await run(
  'voice-ai agents',
  `/voice-ai/agents?locationId=${loc}&pageSize=50`,
  'v3',
)) as { agents?: { id?: string; _id?: string }[]; total?: number } | null;
const agentList = agents?.agents ?? [];
findings.voice_ai_agent_count = agents?.total ?? agentList.length;

const firstAgent = agentList[0];
const agentId = firstAgent?.id ?? firstAgent?._id;
if (agentId) {
  const agent = await run(
    'voice-ai agent detail',
    `/voice-ai/agents/${encodeURIComponent(agentId)}?locationId=${loc}`,
    'v3',
  );
  findings.agent_detail_keys = agent && typeof agent === 'object' ? Object.keys(agent) : null;
}

const logs = (await run(
  'voice-ai call logs',
  `/voice-ai/dashboard/call-logs?locationId=${loc}&pageSize=5`,
  'v3',
)) as { callLogs?: unknown[]; total?: number; [k: string]: unknown } | null;
if (logs) {
  const list = (logs.callLogs ?? Object.values(logs).find(Array.isArray) ?? []) as Record<
    string,
    unknown
  >[];
  findings.call_log_count = logs.total ?? list.length;
  const sample = list[0];
  if (sample) {
    const transcript = sample.transcript;
    findings.call_log_fields = Object.keys(sample);
    findings.transcript_type = Array.isArray(transcript) ? 'array' : typeof transcript;
    // Does the transcript carry per-utterance timing? (needed for turn latency, spike item V8)
    findings.transcript_has_timestamps =
      typeof transcript === 'string'
        ? /\b\d{1,2}:\d{2}(:\d{2})?\b|\[\d+(\.\d+)?s?\]/.test(transcript)
        : Array.isArray(transcript)
          ? JSON.stringify(shapeOf(transcript)).match(/time|start|end|offset/i) !== null
          : false;
    findings.has_recording_field = Object.keys(sample).some((k) => /record/i.test(k));
  }
}

await run('custom values', `/locations/${loc}/customValues`, '2021-07-28');
await run('custom fields', `/locations/${loc}/customFields`, '2021-07-28');
await run('calendars', `/calendars/?locationId=${loc}`, '2021-04-15');
await run('workflows', `/workflows/?locationId=${loc}`, '2021-07-28');
await run('pipelines', `/opportunities/pipelines?locationId=${loc}`, '2021-07-28');
await run('contacts (count only)', `/contacts/?locationId=${loc}&limit=1`, '2021-07-28');
await run('phone numbers', `/phone-system/numbers/location/${loc}`, '2021-07-28');

await mkdir('build/spike', { recursive: true });
await writeFile(
  'build/spike/probe-report.json',
  `${JSON.stringify({ probed_at: new Date().toISOString(), findings, results }, null, 2)}\n`,
);
console.log('\nfindings:', JSON.stringify(findings, null, 2));
console.log('report: build/spike/probe-report.json');
