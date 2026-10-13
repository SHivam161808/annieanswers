/**
 * Load test for the Voice AI action endpoints (GHL-style GET requests).
 *   node load/actions-load.mjs <base-url> <secret> <location-id> [requests-per-step]
 * Steps through 10, 50, 100, 250, 500, 1000 concurrent requests and prints throughput and
 * latency percentiles (nearest rank) per step. Exit code 1 if any step has errors.
 */
import { Pool } from 'undici';

const [baseUrl, secret, locationId, perStepArg] = process.argv.slice(2);
if (!baseUrl || !secret || !locationId) {
  console.error(
    'usage: node load/actions-load.mjs <base-url> <secret> <location-id> [requests-per-step]',
  );
  process.exit(2);
}
const PER_STEP = Number(perStepArg ?? 10_000);
const STEPS = [10, 50, 100, 250, 500, 1000];
const REQUESTS = [
  `/v1/actions/check-service-area?location_id=${locationId}&postcode=LS6+2AB`,
  `/v1/actions/check-service-area?location_id=${locationId}&postcode=M1+1AE`,
  `/v1/actions/call-context?location_id=${locationId}`,
  `/v1/actions/escalation?location_id=${locationId}&trigger=P2`,
];

const pct = (sorted, p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
let failed = false;

console.log('concurrency  rps     p50ms  p90ms  p95ms  p99ms  maxms  errors');
for (const concurrency of STEPS) {
  const pool = new Pool(baseUrl, { connections: concurrency, pipelining: 1 });
  const latencies = [];
  let errors = 0;
  let sent = 0;
  const worker = async () => {
    while (sent < PER_STEP) {
      const path = REQUESTS[sent++ % REQUESTS.length];
      const t0 = performance.now();
      try {
        const res = await pool.request({ path, method: 'GET', headers: { authorization: secret } });
        await res.body.text();
        if (res.statusCode !== 200) errors++;
      } catch {
        errors++;
      }
      latencies.push(performance.now() - t0);
    }
  };
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const seconds = (performance.now() - start) / 1000;
  await pool.close();
  latencies.sort((a, b) => a - b);
  const f = (v) => v.toFixed(1).padStart(6);
  console.log(
    `${String(concurrency).padStart(11)}  ${String(Math.round(PER_STEP / seconds)).padStart(6)} ${f(pct(latencies, 0.5))} ${f(pct(latencies, 0.9))} ${f(pct(latencies, 0.95))} ${f(pct(latencies, 0.99))} ${f(latencies.at(-1))}  ${errors}`,
  );
  if (errors) failed = true;
}
process.exit(failed ? 1 : 0);
