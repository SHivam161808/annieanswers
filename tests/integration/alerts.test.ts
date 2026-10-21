import { readFileSync } from 'node:fs';
import { MockAgent } from 'undici';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { escalation, withAlertResult } from '../../src/actions/escalation.js';
import { OwnerAlerts, parseAlertOverrides } from '../../src/alerts/owner-alerts.js';
import { loadTemplates, renderTemplate } from '../../src/alerts/templates.js';
import { validateClientConfig } from '../../src/clients/config-store.js';
import { GhlClient } from '../../src/ghl/client.js';
import { PostCallProcessor } from '../../src/jobs/post-call.js';
import { createLogger } from '../../src/observability/logger.js';
import { createMetrics } from '../../src/observability/metrics.js';
import { Deadline } from '../../src/observability/timing.js';
import { createRedis } from '../../src/store/redis.js';
import { isolatedRedisUrl } from '../helpers/app.js';

const GHL = 'https://ghl.test';
const LOC = 'loc1';
const raw = parseYaml(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>;
const client = validateClientConfig(raw, 'demo');
const cfg = client.config;
const OWNER = '+447700900123'; // demo alert_sms_number
const templates = loadTemplates();
const silent = createLogger({ level: 'silent', appEnv: 'test', version: 't' });

let agent: MockAgent;
let redis: ReturnType<typeof createRedis>;
let alerts: OwnerAlerts;
let ghl: GhlClient;
const pool = () => agent.get(GHL);

beforeAll(async () => {
  redis = createRedis(await isolatedRedisUrl());
  await redis.connect();
});
afterAll(() => redis.disconnect());
beforeEach(async () => {
  await redis.flushdb();
  agent = new MockAgent();
  agent.disableNetConnect();
  ghl = new GhlClient({
    tokens: new Map([[LOC, 'tok']]),
    dispatcher: agent,
    baseUrl: GHL,
    metrics: createMetrics(),
    log: silent,
    sleep: async () => undefined,
  });
  alerts = new OwnerAlerts({ ghl, redis, log: silent, metrics: createMetrics() });
});
afterEach(async () => {
  agent.assertNoPendingInterceptors();
  await agent.close();
});

const ownerLookup = (contact: unknown) =>
  pool()
    .intercept({
      path: `/contacts/search/duplicate?locationId=${LOC}&number=%2B447700900123`,
      method: 'GET',
    })
    .reply(200, { contact });
const sms = (
  status = 200,
  body: object | string = { messageId: 'm1', conversationId: 'cv1' },
  text?: string,
) =>
  pool()
    .intercept({
      path: '/conversations/messages',
      method: 'POST',
      body: (b) => {
        const j = JSON.parse(b) as { type: string; contactId: string; message: string };
        return (
          j.type === 'SMS' && j.contactId === 'owner1' && (text === undefined || j.message === text)
        );
      },
    })
    .reply(status, body);

describe('templates', () => {
  it('renders merge fields and tidies missing ones', () => {
    expect(
      renderTemplate(
        '{{custom_values.business_name}} URGENT {{contact.ai_urgency}}: {{contact.ai_issue_summary}} {{contact.job_postcode}}. Call {{contact.phone}} now.',
        {
          'custom_values.business_name': 'Smith & Sons',
          'contact.ai_urgency': 'P2',
          'contact.phone': '+447700900999',
        },
      ),
    ).toBe('Smith & Sons URGENT P2: Call +447700900999 now.');
  });
  it('includes the mid-call urgent template', () => {
    expect(templates.get('urgent_call_in_progress_owner')?.to).toBe('owner');
  });
});

describe('OwnerAlerts', () => {
  it('finds the owner contact, sends, caches the contact, and de-duplicates by key', async () => {
    ownerLookup({ id: 'owner1' });
    sms(200, { messageId: 'm1' }, 'hello');
    expect(await alerts.send(LOC, cfg, 'hello', 'call1:x', new Deadline(4000))).toBe('sent');
    expect(await redis.get(`owner-contact:${LOC}:${OWNER}`)).toBe('owner1');
    expect(await alerts.send(LOC, cfg, 'hello', 'call1:x', new Deadline(4000))).toBe('duplicate');
    sms(200, { messageIds: ['m2'] });
    expect(await alerts.send(LOC, cfg, 'again', 'call2:x', new Deadline(4000))).toBe('sent'); // cached contact, no lookup
  });

  it('creates the owner contact when none exists', async () => {
    ownerLookup(null);
    pool()
      .intercept({
        path: '/contacts/',
        method: 'POST',
        body: (b) =>
          (JSON.parse(b) as { phone: string; tags: string[] }).phone === OWNER &&
          (JSON.parse(b) as { tags: string[] }).tags[0] === 'business-owner',
      })
      .reply(201, { contact: { id: 'owner1' } });
    sms();
    expect(await alerts.send(LOC, cfg, 'hi', 'k', new Deadline(4000))).toBe('sent');
  });

  it('a send without a message id is a failure, and the key is released for a retry', async () => {
    ownerLookup({ id: 'owner1' });
    sms(200, { conversationId: 'cv1' });
    expect(await alerts.send(LOC, cfg, 'hi', 'k2', new Deadline(4000))).toBe('failed');
    expect(await redis.get(`alert:${LOC}:k2`)).toBeNull();
    sms(); // contact cached now
    expect(await alerts.send(LOC, cfg, 'hi', 'k2', new Deadline(4000))).toBe('sent');
  });

  it('GHL errors are failures, never "sent"', async () => {
    ownerLookup({ id: 'owner1' });
    sms(500, ''); // POSTs are never retried: a retried send could text the owner twice
    expect(await alerts.send(LOC, cfg, 'hi', 'k3', new Deadline(4000))).toBe('failed');
  });

  it('uses the demo override number when configured', async () => {
    const overridden = new OwnerAlerts({
      ghl,
      redis,
      log: silent,
      metrics: createMetrics(),
      overrides: parseAlertOverrides(`{"${LOC}":"+919876543210"}`),
    });
    expect(overridden.ownerNumber(LOC, cfg)).toBe('+919876543210');
    expect(alerts.ownerNumber(LOC, cfg)).toBe(OWNER);
    expect(() => parseAlertOverrides('{"x":"nope"}')).toThrow('invalid number');
    expect(() => parseAlertOverrides('[]')).toThrow('JSON object');
    expect(parseAlertOverrides(undefined).size).toBe(0);
  });
});

describe('escalation alert instructions follow what actually happened', () => {
  const p2OutOfHours = () =>
    escalation(
      validateClientConfig({ ...raw, transfer_rules: { in_hours: [], out_of_hours: [] } }, 'x'),
      'P2',
      new Date('2026-11-02T22:00:00Z'),
    );
  it('sent: keeps the "alerting now" instruction', () => {
    const r = withAlertResult(p2OutOfHours(), client, 'sent');
    expect(r.owner_alerted).toBe(true);
    expect(r.instruction).toContain('Tell the caller you are sending Dave an urgent alert now.');
  });
  it.each(['failed', 'no_number', 'not_configured'] as const)(
    '%s: never claims the alert was sent, keeps the safety prefix',
    (result) => {
      const r = withAlertResult(p2OutOfHours(), client, result);
      expect(r.owner_alerted).toBe(false);
      expect(r.instruction).toBe(
        'If water is near any electrics, say the water_on_electrics script first, word for word. Give no other instructions about the water. Then: Take their name and best number. Do not say Dave has been alerted; say the details are going to Dave straight away as urgent.',
      );
    },
  );
});

describe('PostCallProcessor', () => {
  const NOW = Date.parse('2026-11-02T12:00:00Z');
  const proc = () =>
    new PostCallProcessor({
      ghl,
      redis,
      alerts,
      templates,
      log: silent,
      now: () => NOW,
      settleMs: 60_000,
      outcomeWaitMs: 600_000,
    });
  const fields = [
    { id: 'f_out', name: 'ai_call_outcome' },
    { id: 'f_sum', name: 'ai_issue_summary' },
    { id: 'f_pc', name: 'job_postcode' },
    { id: 'f_urg', name: 'ai_urgency' },
    { id: 'f_last', name: 'ai_last_call_at' },
    { id: 'f_cnt', name: 'ai_call_count' },
  ];
  const PIPELINES = [
    {
      id: 'p1',
      name: 'AI Receptionist Enquiries',
      stages: [
        { id: 's_cb', name: 'Callback needed' },
        { id: 's_em', name: 'Emergency' },
        { id: 's_bk', name: 'Booked' },
      ],
    },
  ];
  const setup = (logs: object[], pipelines: object[] = PIPELINES, fieldsCached = false) => {
    pool()
      .intercept({ path: /\/voice-ai\/dashboard\/call-logs\?/, method: 'GET' })
      .reply(200, { callLogs: logs, total: logs.length });
    if (!fieldsCached) {
      pool()
        .intercept({ path: `/locations/${LOC}/customFields?model=contact`, method: 'GET' })
        .reply(200, { customFields: fields });
    }
    pool()
      .intercept({ path: `/opportunities/pipelines?locationId=${LOC}`, method: 'GET' })
      .reply(200, { pipelines });
  };
  const contact = (outcome: string, extra: Record<string, unknown> = {}) => ({
    contact: {
      id: 'c1',
      firstName: 'Jane',
      phone: '+447700900999',
      customFields: [
        { id: 'f_out', value: outcome },
        { id: 'f_sum', value: 'Burst pipe in the loft.' },
        { id: 'f_pc', value: 'LS6 2AB' },
        { id: 'f_urg', value: 'P2' },
        { id: 'f_cnt', value: 2 },
      ],
      ...extra,
    },
  });

  it('routes an EMERGENCY_ALERTED call end to end: tags, fields, pipeline, detailed owner alert', async () => {
    setup([{ id: 'call1', createdAt: '2026-11-02T11:50:00Z', contactId: 'c1' }]);
    pool()
      .intercept({ path: '/contacts/c1', method: 'GET' })
      .reply(200, contact('EMERGENCY_ALERTED'));
    pool()
      .intercept({
        path: '/contacts/c1/tags',
        method: 'POST',
        body: (b) => b === '{"tags":["ai-call","outcome-emergency-alerted"]}',
      })
      .reply(201, {});
    pool()
      .intercept({
        path: '/contacts/c1',
        method: 'PUT',
        body: (b) =>
          b ===
          '{"customFields":[{"id":"f_last","field_value":"2026-11-02"},{"id":"f_cnt","field_value":3}]}',
      })
      .reply(200, {});
    pool()
      .intercept({ path: /\/opportunities\/search\?.*contact_id=c1/, method: 'GET' })
      .reply(200, { opportunities: [] });
    pool()
      .intercept({
        path: '/opportunities/',
        method: 'POST',
        body: (b) => (JSON.parse(b) as { pipelineStageId: string }).pipelineStageId === 's_em',
      })
      .reply(201, { opportunity: { id: 'o1' } });
    ownerLookup({ id: 'owner1' });
    sms(
      200,
      { messageId: 'm1' },
      'Smith & Sons Plumbing Ltd URGENT P2: Burst pipe in the loft. LS6 2AB. Call +447700900999 now.',
    );
    expect(await proc().run(LOC, cfg)).toEqual({
      locationId: LOC,
      scanned: 1,
      processed: 1,
      skipped: 0,
      failed: 0,
      alerts: { sent: 1 },
    });

    // A second run does nothing for the same call (field ids now come from the Redis cache).
    setup([{ id: 'call1', createdAt: '2026-11-02T11:50:00Z', contactId: 'c1' }], PIPELINES, true);
    expect(await proc().run(LOC, cfg)).toMatchObject({ processed: 0, skipped: 1 });
  });

  it('updates an existing opportunity and sends no alert for INFO_ONLY', async () => {
    setup([{ id: 'call2', createdAt: '2026-11-02T11:00:00Z', contactId: 'c1' }]);
    pool().intercept({ path: '/contacts/c1', method: 'GET' }).reply(200, contact('INFO_ONLY'));
    pool().intercept({ path: '/contacts/c1/tags', method: 'POST' }).reply(201, {});
    pool().intercept({ path: '/contacts/c1', method: 'PUT' }).reply(200, {});
    const res = await proc().run(LOC, cfg);
    expect(res).toMatchObject({ processed: 1, alerts: {} });
  });

  it('skips trial, contactless, too-recent and already-processed calls; waits for a late outcome', async () => {
    await redis.set(`postcall:done:${LOC}:done1`, '1');
    setup([
      { id: 't', createdAt: '2026-11-02T11:00:00Z', contactId: 'c1', trialCall: true },
      { id: 'n', createdAt: '2026-11-02T11:00:00Z' },
      { id: 'r', createdAt: '2026-11-02T11:59:30Z', contactId: 'c1' },
      { id: 'done1', createdAt: '2026-11-02T11:00:00Z', contactId: 'c1' },
      { id: 'late', createdAt: '2026-11-02T11:55:00Z', contactId: 'c1' },
    ]);
    pool().intercept({ path: '/contacts/c1', method: 'GET' }).reply(200, contact('not-a-code'));
    expect(await proc().run(LOC, cfg)).toMatchObject({
      scanned: 5,
      processed: 0,
      skipped: 5,
      failed: 0,
    });
  });

  it('a failed owner alert leaves the call unprocessed so the next run retries it', async () => {
    setup([{ id: 'call3', createdAt: '2026-11-02T11:00:00Z', contactId: 'c1' }], []);
    pool()
      .intercept({ path: '/contacts/c1', method: 'GET' })
      .reply(200, contact('CALLBACK_REQUESTED'));
    pool().intercept({ path: '/contacts/c1/tags', method: 'POST' }).reply(201, {});
    pool().intercept({ path: '/contacts/c1', method: 'PUT' }).reply(200, {});
    ownerLookup({ id: 'owner1' });
    sms(500, ''); // POSTs are never retried: a retried send could text the owner twice
    expect(await proc().run(LOC, cfg)).toMatchObject({
      processed: 0,
      failed: 1,
      alerts: { failed: 1 },
    });
    expect(await redis.exists(`postcall:done:${LOC}:call3`)).toBe(0);
  });

  it('an outcome missing for too long is still routed and the owner told', async () => {
    setup([{ id: 'old', createdAt: '2026-11-02T10:00:00Z', contactId: 'c1' }], []);
    pool().intercept({ path: '/contacts/c1', method: 'GET' }).reply(200, contact(''));
    pool()
      .intercept({
        path: '/contacts/c1/tags',
        method: 'POST',
        body: (b) => b.includes('outcome-missing'),
      })
      .reply(201, {});
    pool().intercept({ path: '/contacts/c1', method: 'PUT' }).reply(200, {});
    ownerLookup({ id: 'owner1' });
    sms(
      200,
      { messageId: 'm' },
      'Smith & Sons Plumbing Ltd: a call ended without an outcome. Please check the AI receptionist calls.',
    );
    expect(await proc().run(LOC, cfg)).toMatchObject({ processed: 1, alerts: { sent: 1 } });
  });

  it('only one runner per location at a time', async () => {
    await redis.set(`postcall:lock:${LOC}`, '1', 'PX', 10_000);
    expect(await proc().run(LOC, cfg)).toMatchObject({ scanned: 0, processed: 0 });
  });
});
