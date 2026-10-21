import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OwnerAlerts } from '../../src/alerts/owner-alerts.js';
import { loadTemplates } from '../../src/alerts/templates.js';
import { GhlClient } from '../../src/ghl/client.js';
import { PostCallProcessor } from '../../src/jobs/post-call.js';
import { createLogger } from '../../src/observability/logger.js';
import { createMetrics } from '../../src/observability/metrics.js';
import { DEMO_LOCATION, authHeaders, startTestApp, type TestApp } from '../helpers/app.js';

const GHL = 'https://ghl.test';
const SATURDAY_11PM = new Date('2026-11-07T23:00:00Z'); // out of hours, cover 24x7, P2 not transferred
const silent = createLogger({ level: 'silent', appEnv: 'test', version: 't' });
const templates = loadTemplates();

let agent: MockAgent;
let t: TestApp;
const pool = () => agent.get(GHL);

async function start(withGhl = true): Promise<void> {
  agent = new MockAgent();
  agent.disableNetConnect();
  const ghl = new GhlClient({
    tokens: new Map(withGhl ? [[DEMO_LOCATION, 'tok']] : []),
    dispatcher: agent,
    baseUrl: GHL,
    metrics: createMetrics(),
    log: silent,
    sleep: async () => undefined,
  });
  t = await startTestApp({
    now: () => SATURDAY_11PM,
    ghl,
    deps: (redis) => {
      const alerts = new OwnerAlerts({ ghl, redis, log: silent, metrics: createMetrics() });
      return {
        alerts,
        templates,
        postCall: new PostCallProcessor({
          ghl,
          redis,
          alerts,
          templates,
          log: silent,
          now: () => SATURDAY_11PM.getTime(),
        }),
      };
    },
  });
}

afterEach(async () => {
  agent.assertNoPendingInterceptors();
  await t.close();
  await agent.close();
});

const escalate = (trigger: string, callId = 'call_esc_1') =>
  t.app.inject({
    method: 'POST',
    url: '/v1/actions/escalation',
    headers: authHeaders(),
    payload: { location_id: DEMO_LOCATION, call_id: callId, trigger },
  });

function ownerFound(): void {
  pool()
    .intercept({ path: (p) => p.startsWith('/contacts/search/duplicate'), method: 'GET' })
    .reply(200, { contact: { id: 'owner1' } });
}

describe('escalation sends the owner an SMS during the call', () => {
  beforeEach(() => start());

  it('P2 urgent alert: sends once, says the owner was alerted', async () => {
    ownerFound();
    let sent = '';
    pool()
      .intercept({
        path: '/conversations/messages',
        method: 'POST',
        body: (b) => {
          sent = (JSON.parse(b) as { message: string }).message;
          return true;
        },
      })
      .reply(200, { messageId: 'm1' });
    const res = await escalate('P2');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ action: 'urgent_alert', owner_alerted: true });
    expect(sent).toContain('URGENT P2');
    expect(sent).not.toMatch(/\{\{|\}\}/);

    // A retry of the same action in the same call does not text the owner again.
    const again = await escalate('P2');
    expect(again.json()).toMatchObject({ owner_alerted: true });
  });

  it('SMS failure: never claims the owner was alerted', async () => {
    ownerFound();
    pool().intercept({ path: '/conversations/messages', method: 'POST' }).reply(400, {});
    const res = await escalate('P2', 'call_esc_2');
    expect(res.statusCode).toBe(200);
    expect(res.json().owner_alerted).toBe(false);
    expect(res.json().instruction).toContain('Do not say Dave has been alerted');
  });

  it('non-alert triggers make no GHL calls', async () => {
    const res = await escalate('P4');
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('owner_alerted');
  });
});

describe('escalation without GHL credentials', () => {
  beforeEach(() => start(false));

  it('reports not alerted rather than pretending', async () => {
    const res = await escalate('P2');
    expect(res.json()).toMatchObject({ action: 'urgent_alert', owner_alerted: false });
  });
});

describe('POST /v1/jobs/post-call', () => {
  beforeEach(() => start());

  it('requires the shared secret', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/jobs/post-call' });
    expect(res.statusCode).toBe(401);
  });

  it('runs every location with credentials and returns a summary', async () => {
    pool()
      .intercept({ path: (p) => p.startsWith('/voice-ai/dashboard/call-logs'), method: 'GET' })
      .reply(200, { callLogs: [], total: 0 });
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/jobs/post-call',
      headers: authHeaders(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([
      expect.objectContaining({ locationId: DEMO_LOCATION, scanned: 0, failed: 0 }),
    ]);
  });

  it('rejects an unknown location', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/jobs/post-call?location_id=nope',
      headers: authHeaders(),
      payload: {},
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error.code).toBe('config_unavailable');
  });
});
